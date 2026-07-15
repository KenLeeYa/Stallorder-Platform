import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp, hashToken } from "@/lib/security";

const pickupSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
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

  const limit = await checkRateLimit({
    scope: "pickup-verification",
    identifier: `${authorization.principal.user.id}:${orderId}`,
    limit: 8,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "驗證失敗次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": authorization.requestId,
        },
      },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = pickupSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "請輸入六位數取餐碼。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const verifiedAt = new Date();
  const verified = await prisma.$transaction(async (transaction) => {
    const result = await transaction.order.updateMany({
      where: {
        id: orderId,
        stallId: authorization.stall.id,
        fulfillmentType: "TAKEOUT",
        status: "READY",
        pickupVerifiedAt: null,
        pickupCodeHash: hashToken(parsed.data.code),
      },
      data: { pickupVerifiedAt: verifiedAt },
    });
    if (result.count !== 1) return false;

    await transaction.orderEvent.create({
      data: {
        organizationId: authorization.stall.organizationId,
        stallId: authorization.stall.id,
        orderId,
        eventType: "PICKUP_CODE_VERIFIED",
        createdBy: authorization.principal.user.id,
      },
    });
    return true;
  });
  if (!verified) {
    await recordAuditEvent({
      action: "PICKUP_CODE_REJECTED",
      entityType: "ORDER",
      entityId: orderId,
      outcome: "DENIED",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "取餐碼不正確，或訂單尚未進入可取餐狀態。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  await recordAuditEvent({
    action: "PICKUP_CODE_VERIFIED",
    entityType: "ORDER",
    entityId: orderId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
  });
  return NextResponse.json(
    { pickupVerifiedAt: verifiedAt.toISOString() },
    { headers: { "x-request-id": authorization.requestId } },
  );
}
