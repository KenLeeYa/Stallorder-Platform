import { z } from "zod";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { CashShiftOperationError, requireOpenCashShift } from "@/lib/cash-shifts";
import { validateCsrf } from "@/lib/csrf";
import { DiscountApprovalError } from "@/lib/discount-approval";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { createRequestId, hashClientIp } from "@/lib/security";
import { resolveStaffCheckout, StaffCheckoutError } from "@/lib/staff-checkout";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { EntitlementError, entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ stallSlug: string }> };
class TableCheckoutConflict extends Error {}

const tableCheckoutSchema = z.object({
  diningTableId: z.string().uuid(),
  orderIds: z.array(z.string().uuid()).min(1).max(20)
    .refine((ids) => new Set(ids).size === ids.length, "訂單不可重複。"),
  paymentOptionId: z.string().uuid().nullable().optional(),
  discountOptionId: z.string().uuid().nullable().optional(),
  cashReceived: z.number().int().min(0).max(100_000_000).nullable().optional(),
  discountApprovalReason: z.string().trim().min(1).max(200).nullable().optional(),
  managerEmail: z.string().trim().email().max(254).nullable().optional(),
  managerPassword: z.string().min(1).max(128).nullable().optional(),
}).strict();

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/api/stalls/:stallSlug/table-checkout", requestId });
  const response = await handlePatch(request, context, requestId, timing);
  return finalizePerformanceResponse(response, timing);
}

async function handlePatch(
  request: Request,
  context: RouteContext,
  requestId: string,
  timing: ReturnType<typeof createPerformanceTiming>,
) {
  const { stallSlug } = await context.params;
  const authorization = await timing.measure(
    "authMs",
    () => timing.measureDb(
      () => authorizeApiRequest(request, stallSlug, "CHECKOUT_ORDERS", requestId),
      4,
    ),
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = tableCheckoutSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "同桌結帳資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const orders = await timing.measureDb(() => prisma.order.findMany({
    where: {
      id: { in: parsed.data.orderIds },
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      orderNo: true,
      organizationId: true,
      stallId: true,
      diningTableId: true,
      fulfillmentType: true,
      status: true,
      paymentStatus: true,
      subtotal: true,
      total: true,
      items: { select: { status: true } },
    },
  }));
  if (orders.length !== parsed.data.orderIds.length) {
    return NextResponse.json(
      { error: "部分訂單不存在或不屬於此攤位。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (orders.some((order) => (
    order.fulfillmentType !== "DINE_IN"
    || order.diningTableId !== parsed.data.diningTableId
    || order.status !== "READY"
    || order.paymentStatus !== "UNPAID"
  ))) {
    return NextResponse.json(
      { error: "只能合併結帳同一桌、已完成製作且尚未付款的內用訂單。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (orders.some((order) => order.items.some((item) => item.status !== "SERVED"))) {
    return NextResponse.json(
      { error: "同桌仍有餐點尚未出餐。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const subscription = await entitlementService.getSubscriptionContext(
      authorization.stall.organizationId,
    );
    if (!subscription || subscription.status === "CANCELLED") {
      throw new EntitlementError("SUBSCRIPTION_NOT_ACTIVE");
    }
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }

  let checkout: Awaited<ReturnType<typeof resolveStaffCheckout>>;
  try {
    checkout = await timing.measure(
      "authMs",
      () => timing.measureDb(() => resolveStaffCheckout({
        organizationId: authorization.stall.organizationId,
        stallId: authorization.stall.id,
        subtotals: orders.map((order) => order.subtotal),
        currentTotals: orders.map((order) => order.total),
        actorProfileId: authorization.principal.user.id,
        actorRoles: authorization.roles,
        request: parsed.data,
      }), 4),
    );
  } catch (error) {
    if (error instanceof DiscountApprovalError) {
      await timing.measureDb(() => recordAuditEvent({
        organizationId: authorization.stall.organizationId,
        stallId: authorization.stall.id,
        actorProfileId: authorization.principal.user.id,
        action: "DISCOUNT_APPROVAL_FAILED",
        entityType: "DINING_TABLE",
        entityId: parsed.data.diningTableId,
        outcome: "DENIED",
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
        metadata: { reason: error.code, orderCount: orders.length },
      }));
    }
    const response = checkoutErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }

  const now = new Date();
  try {
    const checkoutGroup = await timing.measureDb(() => prisma.$transaction(async (transaction) => {
      const cashShiftId = checkout.method === "CASH"
        ? await requireOpenCashShift(
            transaction,
            authorization.stall.organizationId,
            authorization.stall.id,
          )
        : null;
      const group = await transaction.checkoutGroup.create({
        data: {
          organizationId: authorization.stall.organizationId,
          stallId: authorization.stall.id,
          diningTableId: parsed.data.diningTableId,
          paymentOptionId: checkout.paymentOptionId,
          discountOptionId: checkout.discountOptionId,
          methodLabel: checkout.methodLabel,
          discountLabel: checkout.discountLabel,
          discountRateBps: checkout.discountRateBps,
          subtotal: checkout.subtotal,
          discountAmount: checkout.discountAmount,
          total: checkout.total,
          cashReceived: checkout.cashReceived,
          changeAmount: checkout.changeAmount,
          recordedById: authorization.principal.user.id,
        },
      });

      for (const [index, order] of orders.entries()) {
        const amount = checkout.perOrderAmounts[index];
        const changed = await transaction.order.updateMany({
          where: { id: order.id, stallId: order.stallId, status: "READY", paymentStatus: "UNPAID" },
          data: {
            status: "COMPLETED",
            paymentStatus: "PAID",
            paidAt: now,
            completedAt: now,
            ...(checkout.discountOptionId ? {
              discountOptionId: checkout.discountOptionId,
              discountSource: "STAFF",
              discountLabel: checkout.discountLabel,
              discountRateBps: checkout.discountRateBps,
              discountAppliedById: checkout.discountAppliedById,
              discountApprovedById: checkout.discountApprovedById,
              discountApprovalReason: checkout.discountApprovalReason,
              discountAmount: amount.discountAmount,
              total: amount.total,
            } : {}),
          },
        });
        if (changed.count !== 1) throw new TableCheckoutConflict();
        await transaction.payment.create({
          data: {
            organizationId: order.organizationId,
            stallId: order.stallId,
            orderId: order.id,
            checkoutGroupId: group.id,
            paymentOptionId: checkout.paymentOptionId,
            amount: amount.total,
            method: checkout.method,
            cashShiftId,
            status: "PAID",
            methodLabel: checkout.methodLabel,
            recordedById: authorization.principal.user.id,
            paidAt: now,
          },
        });
        await transaction.orderEvent.create({
          data: {
            organizationId: order.organizationId,
            stallId: order.stallId,
            orderId: order.id,
            eventType: "TABLE_CHECKOUT_COMPLETED",
            previousStatus: "READY",
            newStatus: "COMPLETED",
            createdBy: authorization.principal.user.id,
          },
        });
      }
      return group;
    }), 1 + orders.length * 3);

    await timing.measureDb(() => recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "TABLE_CHECKOUT_COMPLETED",
      entityType: "CHECKOUT_GROUP",
      entityId: checkoutGroup.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        diningTableId: parsed.data.diningTableId,
        orderIds: orders.map((order) => order.id).join(","),
        paymentMethod: checkout.methodLabel,
        discount: checkout.discountLabel,
        discountApprovedBy: checkout.discountApprovedById,
        total: checkout.total,
      },
    }));
    return NextResponse.json(
      { checkoutGroupId: checkoutGroup.id, orderIds: orders.map((order) => order.id) },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const checkoutResponse = checkoutErrorResponse(error, authorization.requestId);
    if (checkoutResponse) return checkoutResponse;
    if (!(error instanceof TableCheckoutConflict)) throw error;
    return NextResponse.json(
      { error: "同桌訂單已被其他人更新，請重新載入後再結帳。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

function checkoutErrorResponse(error: unknown, requestId: string) {
  const headers = { "x-request-id": requestId };
  if (error instanceof CashShiftOperationError && error.code === "ACTIVE_SHIFT_REQUIRED") {
    return NextResponse.json(
      { error: "現金交易前必須先開啟現金班次。", code: error.code },
      { status: 409, headers },
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
    return NextResponse.json({ error: messages[error.code] }, { status: error.code.includes("INVALID") || error.code === "DISCOUNT_DISABLED" ? 409 : 400, headers });
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
