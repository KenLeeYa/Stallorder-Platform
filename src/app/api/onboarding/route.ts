import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, setSessionCookies } from "@/lib/auth";
import { getRequestPrincipal } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, isTrustedOrigin } from "@/lib/security";

const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72);

const onboardingSchema = z.object({
  merchantName: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(120).transform((value) => value.toLowerCase()).optional(),
  password: passwordSchema.optional(),
  phone: z.string().trim().min(6).max(30),
  stallName: z.string().trim().min(2).max(80),
  location: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(3).max(50).regex(/^[a-z0-9-]+$/),
});

export async function POST(request: Request) {
  const requestId = createRequestId();
  const ipHash = hashClientIp(request);
  const principal = await getRequestPrincipal(request);
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "無法驗證申請來源。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }
  if (principal && !validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const rateLimit = await checkRateLimit({
    scope: "merchant-onboarding",
    identifier: ipHash,
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!rateLimit.allowed) {
    await recordAuditEvent({
      action: "RATE_LIMIT_HIT",
      entityType: "ONBOARDING",
      outcome: "DENIED",
      requestId,
      ipHash,
    });
    return NextResponse.json(
      { error: "申請次數過多，請稍後再試。" },
      {
        status: 429,
        headers: { "retry-after": String(rateLimit.retryAfterSeconds), "x-request-id": requestId },
      },
    );
  }

  const body = await readJson(request, requestId);
  if (body.error) return body.error;
  const parsed = onboardingSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "申請資料格式不正確，密碼需至少 12 個字元。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const data = parsed.data;
  if (!principal && (!data.email || !data.displayName || !data.password)) {
    return NextResponse.json(
      { error: "申請資料不完整，密碼需至少 12 個字元。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
  const passwordHash = data.password ? await hash(data.password, 12) : null;

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const existingProfile = principal
        ? await transaction.profile.findUnique({ where: { id: principal.user.id } })
        : null;
      if (principal && !existingProfile?.isActive) throw new Error("PROFILE_NOT_AVAILABLE");
      if (principal) {
        const [organizationAccess, stallAccess] = await Promise.all([
          transaction.organizationMembership.count({
            where: { profileId: principal.user.id, isActive: true },
          }),
          transaction.stallMembership.count({
            where: { profileId: principal.user.id, isActive: true },
          }),
        ]);
        if (organizationAccess > 0 || stallAccess > 0) throw new Error("PROFILE_ALREADY_ONBOARDED");
      }

      const accountEmail = existingProfile?.email ?? data.email!;
      const organization = await transaction.organization.create({
        data: {
          name: data.merchantName,
          businessName: data.merchantName,
          slug: `${data.slug}-organization`,
          email: accountEmail,
          phone: data.phone,
        },
      });
      const stall = await transaction.stall.create({
        data: {
          organizationId: organization.id,
          name: data.stallName,
          slug: data.slug,
          code: data.slug.toUpperCase(),
          address: data.location,
          location: data.location,
          orderingSettings: { create: { organizationId: organization.id } },
          qrCodes: {
            create: {
              organizationId: organization.id,
              token: randomBytes(32).toString("base64url"),
              label: "主要點餐 QR v1",
            },
          },
        },
      });
      const category = await transaction.productCategory.create({
        data: {
          organizationId: organization.id,
          stallId: stall.id,
          name: "熱門",
          sortOrder: 1,
        },
      });
      await transaction.product.create({
        data: {
          organizationId: organization.id,
          stallId: stall.id,
          categoryId: category.id,
          name: "招牌商品",
          description: "請將此商品改成您的熱門品項。",
          price: 80,
          sortOrder: 1,
        },
      });
      const profile = existingProfile ?? await transaction.profile.create({
        data: {
          email: accountEmail,
          passwordHash: passwordHash!,
          displayName: data.displayName!,
        },
      });
      await transaction.organizationMembership.create({
        data: {
          organizationId: organization.id,
          profileId: profile.id,
          role: "ORGANIZATION_OWNER",
          allStalls: true,
        },
      });
      return { organization, stall, profile };
    });

    const session = await createSession(result.profile.id);
    const response = NextResponse.json(
      {
        stallSlug: result.stall.slug,
        next: `/merchant/dashboard?organizationId=${result.organization.id}`,
      },
      { status: 201, headers: { "x-request-id": requestId } },
    );
    setSessionCookies(response, session);
    await recordAuditEvent({
      organizationId: result.organization.id,
      action: "MERCHANT_ONBOARDING_COMPLETED",
      entityType: "STALL",
      entityId: result.stall.id,
      outcome: "SUCCESS",
      requestId,
      stallId: result.stall.id,
      actorProfileId: result.profile.id,
      ipHash,
    });
    return response;
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const alreadyOnboarded = error instanceof Error && error.message === "PROFILE_ALREADY_ONBOARDED";
    return NextResponse.json(
      {
        error: alreadyOnboarded
          ? "此帳號已經具有組織權限。"
          : conflict
            ? "此電子郵件或攤位網址已被使用。"
            : "目前無法完成申請，請稍後再試。",
      },
      { status: alreadyOnboarded || conflict ? 409 : 500, headers: { "x-request-id": requestId } },
    );
  }
}
