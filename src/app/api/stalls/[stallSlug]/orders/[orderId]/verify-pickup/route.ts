import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import { verifyReadyTakeoutOrder } from "@/server/orders/pickup-verification-service";

const pickupSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("CODE"), code: z.string().regex(/^\d{3}$|^\d{6}$/) }).strict(),
  z.object({
    mode: z.literal("MANUAL"),
    confirmationOrderNo: z.string().trim().min(1).max(30),
    reason: z.enum(["DEVICE_LOST", "TRACKING_UNAVAILABLE", "OTHER"]),
    confirmedCustomerDetails: z.literal(true),
  }).strict(),
]);
type RouteContext = { params: Promise<{ stallSlug: string; orderId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug, orderId } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "CHECKOUT_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = pickupSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "取餐驗證資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const limit = await checkRateLimit({
    scope: parsed.data.mode === "CODE" ? "pickup-verification" : "pickup-manual-verification",
    identifier: `${authorization.principal.user.id}:${orderId}`,
    limit: parsed.data.mode === "CODE" ? 5 : 3,
    windowMs: parsed.data.mode === "CODE" ? 10 * 60_000 : 60 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "驗證嘗試次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": authorization.requestId,
        },
      },
    );
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, stallId: authorization.stall.id },
    select: { orderNo: true, pickupCodeLength: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: "找不到此訂單。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (parsed.data.mode === "CODE" && parsed.data.code.length !== order.pickupCodeLength) {
    return NextResponse.json(
      { error: `請輸入${order.pickupCodeLength === 3 ? "三" : "六"}位數取餐碼。` },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const verificationMethod = parsed.data.mode;
  const verified = await verifyReadyTakeoutOrder({
    orderId,
    stallId: authorization.stall.id,
    organizationId: authorization.stall.organizationId,
    actorProfileId: authorization.principal.user.id,
    verificationMethod,
    ...(parsed.data.mode === "CODE"
      ? { code: parsed.data.code }
      : { confirmationOrderNo: parsed.data.confirmationOrderNo }),
  });
  if (!verified) {
    await recordAuditEvent({
      action: verificationMethod === "CODE" ? "PICKUP_CODE_REJECTED" : "PICKUP_MANUAL_REJECTED",
      entityType: "ORDER",
      entityId: orderId,
      outcome: "DENIED",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
      metadata: verificationMethod === "MANUAL" ? { reason: parsed.data.reason } : undefined,
    });
    return NextResponse.json(
      { error: verificationMethod === "CODE" ? "取餐碼不正確，或訂單尚未進入可取餐狀態。" : "人工核對資料不符，或訂單尚未進入可取餐狀態。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  await recordAuditEvent({
    action: verificationMethod === "CODE" ? "PICKUP_CODE_VERIFIED" : "PICKUP_MANUALLY_VERIFIED",
    entityType: "ORDER",
    entityId: orderId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
    metadata: verificationMethod === "MANUAL" ? { reason: parsed.data.reason } : undefined,
  });
  return NextResponse.json(
    {
      pickupVerifiedAt: verified.pickupVerifiedAt.toISOString(),
      pickupVerificationMethod: verified.pickupVerificationMethod,
    },
    { headers: { "x-request-id": authorization.requestId } },
  );
}
