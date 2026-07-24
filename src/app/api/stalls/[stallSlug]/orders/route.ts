import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { DiscountApprovalError } from "@/lib/discount-approval";
import { readJson } from "@/lib/http";
import { activeOrderStatuses, serializeStaffOrder, staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { createStaffOrderSchema } from "@/lib/staff-order-contract";
import { createStaffOrder, StaffOrderCreateError } from "@/lib/staff-order-create";
import { StaffCheckoutError } from "@/lib/staff-checkout";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;

  const orders = await prisma.order.findMany({
    where: { stallId: authorization.stall.id, status: { in: [...activeOrderStatuses] } },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: staffOrderSelect,
  });

  return NextResponse.json(
    { orders: orders.map(serializeStaffOrder) },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "CREATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = createStaffOrderSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "店員點餐資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    await entitlementService.assertLimitAvailable(authorization.stall.organizationId, "ORDERS", 1);
    const result = await createStaffOrder({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      actorRoles: authorization.roles,
      request: parsed.data,
    });
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: result.idempotent ? "STAFF_ORDER_IDEMPOTENT_REPLAY" : "STAFF_ORDER_CREATED",
      entityType: "ORDER",
      entityId: result.order.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        fulfillmentType: result.order.fulfillmentType,
        paymentStatus: result.order.paymentStatus,
        itemCount: result.order.items.length,
        total: result.order.total,
      },
    });
    return NextResponse.json(
      { order: serializeStaffOrder(result.order), idempotent: result.idempotent },
      {
        status: result.idempotent ? 200 : 201,
        headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
      },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const response = staffOrderErrorResponse(error, authorization.requestId);
    if (response) return response;
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "STAFF_ORDER_CREATE_FAILED",
      entityType: "ORDER",
      outcome: "FAILURE",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "目前無法建立訂單，請稍後再試。" },
      { status: 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

function staffOrderErrorResponse(error: unknown, requestId: string) {
  const headers = { "x-request-id": requestId };
  if (error instanceof StaffOrderCreateError) {
    const messages: Record<StaffOrderCreateError["code"], string> = {
      ORDER_LIMIT_EXCEEDED: "商品數量或備註超過此攤位設定的上限。",
      PRODUCT_UNAVAILABLE: "商品供應或價格剛剛已變更，請重新選擇。",
      INVALID_PRODUCT_NOTES: "商品註記未符合必選或數量限制。",
      TABLE_UNAVAILABLE: "內用桌位已停用或不存在。",
      DELIVERY_UNAVAILABLE: "此攤位尚未開啟外送模組。",
      ACTIVE_SHIFT_REQUIRED: "現金交易前必須先開啟現金班次。",
      ORDER_CONFLICT: "訂單編號或防重複識別發生衝突，請重新送出。",
    };
    return NextResponse.json(
      { error: messages[error.code], code: error.code },
      { status: error.code === "ORDER_CONFLICT" || error.code === "ACTIVE_SHIFT_REQUIRED" ? 409 : 400, headers },
    );
  }
  if (error instanceof StaffCheckoutError) {
    const messages: Record<StaffCheckoutError["code"], string> = {
      PAYMENT_REQUIRED: "請選擇付款方式。",
      PAYMENT_INVALID: "付款方式已停用或不存在，請重新選擇。",
      DISCOUNT_DISABLED: "此攤位尚未開啟折扣模組。",
      DISCOUNT_INVALID: "折扣已停用或不存在，請重新選擇。",
      INSUFFICIENT_CASH: "實收金額不可小於應收金額。",
    };
    return NextResponse.json({ error: messages[error.code], code: error.code }, { status: 400, headers });
  }
  if (error instanceof DiscountApprovalError) {
    const messages: Record<DiscountApprovalError["code"], string> = {
      REASON_REQUIRED: "超過折扣門檻時必須填寫核准原因。",
      CREDENTIALS_REQUIRED: "此折扣需要經理帳號與密碼核准。",
      INVALID_MANAGER: "經理驗證失敗或帳號沒有折扣核准權限。",
      RATE_LIMITED: "經理驗證嘗試過多，請稍後再試。",
    };
    return NextResponse.json(
      { error: messages[error.code], code: error.code },
      { status: error.code === "RATE_LIMITED" ? 429 : error.code === "INVALID_MANAGER" ? 403 : 400, headers },
    );
  }
  return null;
}
