import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestPrincipal } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, isTrustedOrigin } from "@/lib/security";

const onboardingSchema = z.object({
  merchantName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(30),
  stallName: z.string().trim().min(2).max(80),
  location: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(3).max(50).regex(/^[a-z0-9-]+$/),
}).strict();

export async function POST(request: Request) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/api/onboarding", requestId });
  const response = await handlePost(request, requestId, timing);
  return finalizePerformanceResponse(response, timing);
}

async function handlePost(
  request: Request,
  requestId: string,
  timing: ReturnType<typeof createPerformanceTiming>,
) {
  const ipHash = hashClientIp(request);
  const principal = await timing.measure(
    "sessionMs",
    () => timing.measureDb(() => getRequestPrincipal(request)),
  );
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "無法驗證申請來源。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }
  if (!principal?.user.authUserId) {
    return NextResponse.json(
      { error: "請先使用 Google 帳號登入，再建立商家。" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }
  if (!validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const rateLimit = await timing.measureDb(() => checkRateLimit({
    scope: "merchant-onboarding",
    identifier: ipHash,
    limit: 5,
    windowMs: 60 * 60_000,
  }));
  if (!rateLimit.allowed) {
    await timing.measureDb(() => recordAuditEvent({
      action: "RATE_LIMIT_HIT",
      entityType: "ONBOARDING",
      outcome: "DENIED",
      requestId,
      ipHash,
    }));
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
      { error: "申請資料格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const data = parsed.data;
  try {
    const result = await timing.measureDb(() => prisma.$transaction(async (transaction) => {
      const existingProfile = await transaction.profile.findUnique({ where: { id: principal.user.id } });
      if (!existingProfile?.isActive || existingProfile.authUserId !== principal.user.authUserId) {
        throw new Error("PROFILE_NOT_AVAILABLE");
      }
      const [organizationAccess, stallAccess] = await Promise.all([
        transaction.organizationMembership.count({
          where: { profileId: principal.user.id, isActive: true },
        }),
        transaction.stallMembership.count({
          where: { profileId: principal.user.id, isActive: true },
        }),
      ]);
      if (organizationAccess > 0 || stallAccess > 0) throw new Error("PROFILE_ALREADY_ONBOARDED");

      const accountEmail = existingProfile.email;
      const organization = await transaction.organization.create({
        data: {
          name: data.merchantName,
          businessName: data.merchantName,
          slug: `${data.slug}-organization`,
          email: accountEmail,
          phone: data.phone,
        },
      });
      const litePlan = await transaction.plan.findUniqueOrThrow({ where: { code: "LITE" } });
      const billingPeriodStart = new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00.000Z");
      const billingPeriodEnd = new Date(billingPeriodStart);
      billingPeriodEnd.setUTCMonth(billingPeriodEnd.getUTCMonth() + 1);
      await transaction.subscription.create({
        data: {
          organizationId: organization.id,
          planId: litePlan.id,
          status: "TRIALING",
          billingPeriodStart,
          billingPeriodEnd,
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
          name: "熱門",
          sortOrder: 1,
        },
      });
      const product = await transaction.product.create({
        data: {
          organizationId: organization.id,
          categoryId: category.id,
          name: "招牌商品",
          description: "請將此商品改成您的熱門品項。",
          defaultPrice: 80,
          sortOrder: 1,
        },
      });
      await transaction.stallProduct.create({
        data: {
          organizationId: organization.id,
          stallId: stall.id,
          productId: product.id,
          sortOrder: 1,
        },
      });
      await transaction.organizationMembership.create({
        data: {
          organizationId: organization.id,
          profileId: existingProfile.id,
          role: "ORGANIZATION_OWNER",
          allStalls: true,
          isPrimaryOwner: true,
        },
      });
      return { organization, stall, profile: existingProfile };
    }), 11);

    const response = NextResponse.json(
      {
        stallSlug: result.stall.slug,
        next: `/merchant/dashboard?organizationId=${result.organization.id}`,
      },
      { status: 201, headers: { "x-request-id": requestId } },
    );
    await timing.measureDb(() => recordAuditEvent({
      organizationId: result.organization.id,
      action: "MERCHANT_ONBOARDING_COMPLETED",
      entityType: "STALL",
      entityId: result.stall.id,
      outcome: "SUCCESS",
      requestId,
      stallId: result.stall.id,
      actorProfileId: result.profile.id,
      ipHash,
    }));
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
