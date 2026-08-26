import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { serializeStaffOrder, staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import {
  findReadyPickupOrdersByCode,
  verifyReadyTakeoutOrder,
} from "@/server/orders/pickup-verification-service";

const pickupCodeSchema = z.object({
  code: z.string().regex(/^\d{3}$|^\d{6}$/),
}).strict();

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
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
  const parsed = pickupCodeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "請輸入三位或六位數取餐碼。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const limit = await checkRateLimit({
    scope: "pickup-code-quick-checkout",
    identifier: `${authorization.principal.user.id}:${authorization.stall.id}`,
    limit: 5,
    windowMs: 10 * 60_000,
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

  const candidates = await findReadyPickupOrdersByCode({
    stallId: authorization.stall.id,
    code: parsed.data.code,
  });
  if (candidates.length !== 1) {
    await recordAuditEvent({
      action: "PICKUP_CODE_QUICK_CHECKOUT_REJECTED",
      entityType: "ORDER",
      outcome: "DENIED",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
      metadata: { reason: candidates.length > 1 ? "AMBIGUOUS" : "NOT_FOUND" },
    });
    return NextResponse.json(
      candidates.length > 1
        ? { error: "此取餐碼同時符合多張訂單，請改從訂單清單核對。", code: "PICKUP_CODE_AMBIGUOUS" }
        : { error: "找不到可取餐的訂單，請確認取餐碼與訂單狀態。", code: "PICKUP_CODE_NOT_FOUND" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const orderId = candidates[0].id;
  const verified = await verifyReadyTakeoutOrder({
    orderId,
    stallId: authorization.stall.id,
    organizationId: authorization.stall.organizationId,
    actorProfileId: authorization.principal.user.id,
    verificationMethod: "CODE",
    code: parsed.data.code,
  });
  if (!verified) {
    return NextResponse.json(
      { error: "訂單狀態已變更，請重新整理後再試。", code: "PICKUP_ORDER_CHANGED" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, stallId: authorization.stall.id },
    select: staffOrderSelect,
  });
  if (!order) {
    return NextResponse.json(
      { error: "訂單已更新，請重新整理訂單清單。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  await recordAuditEvent({
    action: "PICKUP_CODE_QUICK_CHECKOUT_LOADED",
    entityType: "ORDER",
    entityId: orderId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    stallId: authorization.stall.id,
    actorProfileId: authorization.principal.user.id,
    ipHash: hashClientIp(request),
  });
  return NextResponse.json(
    { order: serializeStaffOrder(order) },
    { headers: { "x-request-id": authorization.requestId } },
  );
}
