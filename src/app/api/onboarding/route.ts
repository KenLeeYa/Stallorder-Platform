import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, setSessionCookies } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { readJson } from "@/lib/http";
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
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120).transform((value) => value.toLowerCase()),
  password: passwordSchema,
  phone: z.string().trim().min(6).max(30),
  stallName: z.string().trim().min(2).max(80),
  location: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(3).max(50).regex(/^[a-z0-9-]+$/),
});

export async function POST(request: Request) {
  const requestId = createRequestId();
  const ipHash = hashClientIp(request);
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "無法驗證申請來源。" },
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
  const passwordHash = await hash(data.password, 12);

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const merchant = await transaction.merchant.create({
        data: {
          name: data.merchantName,
          slug: `${data.slug}-tenant`,
          email: data.email,
          phone: data.phone,
        },
      });
      const stall = await transaction.stall.create({
        data: {
          merchantId: merchant.id,
          name: data.stallName,
          slug: data.slug,
          location: data.location,
          orderingSettings: { create: { tenantId: merchant.id } },
          qrCodes: {
            create: {
              tenantId: merchant.id,
              token: randomBytes(32).toString("base64url"),
              label: "主要點餐 QR v1",
            },
          },
        },
      });
      const category = await transaction.productCategory.create({
        data: {
          tenantId: merchant.id,
          stallId: stall.id,
          name: "熱門",
          sortOrder: 1,
        },
      });
      await transaction.product.create({
        data: {
          tenantId: merchant.id,
          stallId: stall.id,
          categoryId: category.id,
          name: "招牌商品",
          description: "請將此商品改成您的熱門品項。",
          price: 80,
          sortOrder: 1,
        },
      });
      const user = await transaction.userAccount.create({
        data: {
          email: data.email,
          passwordHash,
          displayName: data.displayName,
          memberships: {
            create: { tenantId: merchant.id, stallId: stall.id, role: "MERCHANT_OWNER" },
          },
        },
      });
      return { stall, user };
    });

    const session = await createSession(result.user.id);
    const response = NextResponse.json(
      { stallSlug: result.stall.slug },
      { status: 201, headers: { "x-request-id": requestId } },
    );
    setSessionCookies(response, session);
    await recordAuditEvent({
      tenantId: result.stall.merchantId,
      action: "MERCHANT_ONBOARDING_COMPLETED",
      entityType: "STALL",
      entityId: result.stall.id,
      outcome: "SUCCESS",
      requestId,
      stallId: result.stall.id,
      actorUserId: result.user.id,
      ipHash,
    });
    return response;
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json(
      { error: conflict ? "此電子郵件或攤位網址已被使用。" : "目前無法完成申請，請稍後再試。" },
      { status: conflict ? 409 : 500, headers: { "x-request-id": requestId } },
    );
  }
}
