import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { CashShiftOperationError, requireOpenCashShift } from "@/lib/cash-shifts";
import { validateCsrf } from "@/lib/csrf";
import { DiscountApprovalError } from "@/lib/discount-approval";
import { readJson } from "@/lib/http";
import { classifyStallOrderForProduction } from "@/lib/fulfillment-time";
import { cancellationMatchesOrder, orderStatusUpdateSchema } from "@/lib/order-status-update";
import { staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { canTransitionOrder, hasPermission } from "@/lib/rbac";
import { createRequestId, hashClientIp } from "@/lib/security";
import { resolveStaffCheckout, StaffCheckoutError } from "@/lib/staff-checkout";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import {
  canContinueOrderDuringSuspension,
  EntitlementError,
  entitlementService,
} from "@/server/billing/entitlement-service";
import {
  acknowledgeExternalOrderBeforeTransition,
  persistExternalOrderTransition,
} from "@/server/delivery-platforms/external-order-status-service";
import { DeliveryPlatformError } from "@/server/delivery-platforms/delivery-platform-errors";
import { getStreamlinedCheckoutPlan } from "@/server/printing/streamlined-order-completion";

type RouteContext = { params: Promise<{ stallSlug: string; orderId: string }> };
class TransitionConflict extends Error {}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({
    route: "/api/stalls/:stallSlug/orders/:orderId",
    requestId,
  });
  const response = await handlePatch(request, context, requestId, timing);
  return finalizePerformanceResponse(response, timing);
}

async function handlePatch(
  request: Request,
  context: RouteContext,
  requestId: string,
  timing: ReturnType<typeof createPerformanceTiming>,
) {
  const { stallSlug, orderId } = await context.params;
  const authorization = await timing.measure(
    "authMs",
    () => timing.measureDb(
      () => authorizeApiRequest(request, stallSlug, "UPDATE_ORDERS", requestId),
      4,
    ),
  );
  if (!authorization.ok) return authorization.response;

  if (!validateCsrf(request, authorization.principal)) {
    await timing.measureDb(() => recordAuditEvent({
      action: "CSRF_VALIDATION_FAILED",
      entityType: "ORDER",
      entityId: orderId,
      outcome: "DENIED",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    }));
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = orderStatusUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "訂單狀態格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const order = await timing.measureDb(() => prisma.order.findFirst({
    where: { id: orderId, stallId: authorization.stall.id },
    include: {
      stall: {
        select: {
          timezone: true,
          orderingSettings: {
            select: {
              businessDayCutoffHour: true,
              kdsModuleEnabled: true,
              printModuleEnabled: true,
            },
          },
        },
      },
      items: {
        select: {
          unitPrice: true,
          quantity: true,
          isOrderDiscountEligible: true,
        },
      },
    },
  }));
  if (!order) {
    return NextResponse.json(
      { error: "找不到此訂單。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const nextStatus = parsed.data.status;
  const cancellation = parsed.data.status === "CANCELLED" ? parsed.data : null;
  const orderingSettings = order.stall.orderingSettings;
  const primaryPrintJob = nextStatus === "COMPLETED"
    && !orderingSettings?.kdsModuleEnabled
    && orderingSettings?.printModuleEnabled
    && order.externalProvider === null
    ? await timing.measureDb(() => prisma.printJob.findFirst({
        where: { orderId: order.id, reprintOfId: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { status: true },
      }))
    : null;
  const streamlinedCheckout = getStreamlinedCheckoutPlan({
    requestedStatus: nextStatus,
    currentStatus: order.status,
    fulfillmentType: order.fulfillmentType,
    kdsModuleEnabled: orderingSettings?.kdsModuleEnabled ?? true,
    printModuleEnabled: orderingSettings?.printModuleEnabled ?? false,
    externalProvider: order.externalProvider,
    primaryPrintStatus: primaryPrintJob?.status ?? null,
  });
  try {
    const subscription = await entitlementService.getSubscriptionContext(order.organizationId);
    if (!subscription || subscription.status === "CANCELLED") {
      throw new EntitlementError("SUBSCRIPTION_NOT_ACTIVE");
    }
    if (
      subscription.status === "SUSPENDED"
      && !canContinueOrderDuringSuspension(order.status, nextStatus)
    ) {
      throw new EntitlementError("SUBSCRIPTION_SUSPENDED");
    }
    if (streamlinedCheckout?.queuePrint) {
      await entitlementService.assertFeatureEnabled(order.organizationId, "PRINTER_INTEGRATION");
    }
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
  if (
    nextStatus === "CANCELLED"
    && !cancellationMatchesOrder(parsed.data.confirmationOrderNo, order.orderNo)
  ) {
    await timing.measureDb(() => recordAuditEvent({
      action: "ORDER_CANCELLATION_CONFIRMATION_FAILED",
      entityType: "ORDER",
      entityId: order.id,
      outcome: "DENIED",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    }));
    return NextResponse.json(
      { error: "取消確認資料與目前訂單不符，訂單未取消。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  if (!streamlinedCheckout && !canTransitionOrder(order.status, nextStatus, authorization.role)) {
    return NextResponse.json(
      { error: "目前狀態不允許此操作。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (
    nextStatus === "COMPLETED"
    && streamlinedCheckout
    && classifyStallOrderForProduction(order).productionBlocked
  ) {
    return NextResponse.json(
      {
        error: "此預約訂單的履約營業日尚未到，或履約時間尚未確認，暫時不能結帳完成。",
        code: "PRODUCTION_NOT_DUE",
      },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (nextStatus === "PREPARING"
    && order.status === "CONFIRMED"
    && classifyStallOrderForProduction(order).productionBlocked) {
    return NextResponse.json(
      {
        error: "此訂單的履約營業日尚未到，或履約時間尚未確認，暫時不能開始製作。",
        code: "PRODUCTION_NOT_DUE",
      },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (nextStatus === "COMPLETED" && !hasPermission(authorization.role, "CHECKOUT_ORDERS")) {
    return NextResponse.json(
      { error: "您沒有完成訂單的權限。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (
    nextStatus === "COMPLETED"
    && order.fulfillmentType === "TAKEOUT"
    && order.source === "QR_MENU"
    && !order.pickupVerifiedAt
  ) {
    return NextResponse.json(
      { error: "請先驗證顧客的取餐碼。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  let checkout: Awaited<ReturnType<typeof resolveStaffCheckout>> | null = null;

  if (nextStatus === "COMPLETED" && !streamlinedCheckout) {
    const incompleteItemCount = await timing.measureDb(() => prisma.orderItem.count({
      where: {
        orderId: order.id,
        stallId: order.stallId,
        status: order.fulfillmentType === "DINE_IN"
          ? { not: "SERVED" }
          : { notIn: ["READY", "SERVED"] },
      },
    }));
    if (incompleteItemCount > 0) {
      return NextResponse.json(
        { error: order.fulfillmentType === "DINE_IN" ? "仍有餐點尚未出餐。" : "仍有餐點尚未完成製作。" },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }
  }

  const streamlinedPrinter = streamlinedCheckout?.queuePrint
    ? await timing.measureDb(() => prisma.printer.findFirst({
        where: {
          organizationId: order.organizationId,
          stallId: order.stallId,
          isEnabled: true,
          lastSeenAt: { gte: new Date(Date.now() - 90_000) },
        },
        orderBy: [{ lastSeenAt: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      }))
    : null;
  if (streamlinedCheckout?.queuePrint && !streamlinedPrinter) {
    return NextResponse.json(
      {
        error: "請先啟用並連接至少一台印表機；本次尚未扣款，也未完成訂單。",
        code: "PRINTER_REQUIRED",
      },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  if (parsed.data.status === "COMPLETED" && order.paymentStatus === "UNPAID") {
    const checkoutRequest = parsed.data;
    try {
      checkout = await timing.measureDb(() => resolveStaffCheckout({
        organizationId: order.organizationId,
        stallId: order.stallId,
        subtotals: [order.subtotal],
        discountEligibleSubtotals: [order.items.reduce((sum, item) => (
          sum + (item.isOrderDiscountEligible ? item.unitPrice * item.quantity : 0)
        ), 0)],
        currentTotals: [order.total],
        actorProfileId: authorization.principal.user.id,
        actorRoles: authorization.roles,
        request: checkoutRequest,
      }), 4);
    } catch (error) {
      if (error instanceof DiscountApprovalError) {
        await timing.measureDb(() => recordAuditEvent({
          organizationId: order.organizationId,
          stallId: order.stallId,
          actorProfileId: authorization.principal.user.id,
          action: "DISCOUNT_APPROVAL_FAILED",
          entityType: "ORDER",
          entityId: order.id,
          outcome: "DENIED",
          requestId: authorization.requestId,
          ipHash: hashClientIp(request),
          metadata: { reason: error.code },
        }));
      }
      const response = checkoutErrorResponse(error, authorization.requestId);
      if (response) return response;
      throw error;
    }
  }

  let externalTransition: Awaited<ReturnType<typeof acknowledgeExternalOrderBeforeTransition>>;
  try {
    externalTransition = await timing.measureDb(() => acknowledgeExternalOrderBeforeTransition({
      orderId: order.id,
      nextStatus,
    }));
  } catch (error) {
    if (error instanceof DeliveryPlatformError) {
      return NextResponse.json(
        {
          error: error.retryable
            ? "外送平台暫時無法確認此操作，訂單狀態尚未變更，請稍後再試。"
            : "目前無法變更此外送訂單，請確認外送平台連線與功能狀態。",
          code: error.code,
        },
        {
          status: error.retryable ? 503 : 409,
          headers: { "x-request-id": authorization.requestId },
        },
      );
    }
    throw error;
  }

  const now = new Date();
  const persistedStatus = streamlinedCheckout?.targetStatus ?? nextStatus;
  try {
    const updatedOrder = await timing.measureDb(() => prisma.$transaction(async (transaction) => {
      const cashShiftId = checkout?.method === "CASH"
        ? await requireOpenCashShift(transaction, order.organizationId, order.stallId)
        : null;
      const changed = await transaction.order.updateMany({
        where: {
          id: order.id,
          stallId: authorization.stall.id,
          status: order.status,
          ...(order.status === "WAITING_CONFIRMATION"
            ? { confirmationExpiresAt: { gt: now } }
            : {}),
        },
        data: {
          status: persistedStatus,
          confirmedAt: persistedStatus === "CONFIRMED" ? now : order.confirmedAt,
          completedAt: persistedStatus === "COMPLETED" ? now : order.completedAt,
          paymentStatus: nextStatus === "COMPLETED" ? "PAID" : order.paymentStatus,
          paidAt: nextStatus === "COMPLETED" && order.paymentStatus === "UNPAID" ? now : order.paidAt,
          ...(checkout?.discountOptionId ? {
            discountOptionId: checkout.discountOptionId,
            discountSource: "STAFF",
            discountLabel: checkout.discountLabel,
            discountRateBps: checkout.discountRateBps,
            discountAppliedById: checkout.discountAppliedById,
            discountApprovedById: checkout.discountApprovedById,
            discountApprovalReason: checkout.discountApprovalReason,
            discountAmount: checkout.discountAmount,
            total: checkout.total,
          } : {}),
          cancellationReason: cancellation?.cancellationReason ?? order.cancellationReason,
          cancellationDetail: cancellation ? cancellation.cancellationDetail ?? null : order.cancellationDetail,
          cancelledAt: nextStatus === "CANCELLED" ? now : order.cancelledAt,
          cancelledById: nextStatus === "CANCELLED" ? authorization.principal.user.id : order.cancelledById,
        },
      });
      if (changed.count !== 1) throw new TransitionConflict();

      if (streamlinedCheckout) {
        await transaction.orderItem.updateMany({
          where: { orderId: order.id, stallId: order.stallId },
          data: {
            status: streamlinedCheckout.itemStatus,
            readyAt: now,
            ...(streamlinedCheckout.itemStatus === "SERVED" ? { servedAt: now } : {}),
          },
        });
        if (streamlinedCheckout.queuePrint) {
          await transaction.printJob.createMany({
            data: [{
              organizationId: order.organizationId,
              stallId: order.stallId,
              orderId: order.id,
              printerId: streamlinedPrinter!.id,
              requestedById: authorization.principal.user.id,
            }],
            skipDuplicates: true,
          });
        }
      }

      if (nextStatus === "COMPLETED" && order.paymentStatus === "UNPAID") {
        if (!checkout) throw new Error("CHECKOUT_NOT_RESOLVED");
        await transaction.payment.create({
          data: {
            organizationId: order.organizationId,
            stallId: order.stallId,
            orderId: order.id,
            paymentOptionId: checkout.paymentOptionId,
            amount: checkout.total,
            method: checkout.method,
            cashShiftId,
            status: "PAID",
            methodLabel: checkout.methodLabel,
            cashReceived: checkout.cashReceived,
            changeAmount: checkout.changeAmount,
            recordedById: authorization.principal.user.id,
            paidAt: now,
          },
        });
      }

      await transaction.orderEvent.create({
        data: {
          organizationId: order.organizationId,
          stallId: order.stallId,
          orderId: order.id,
          eventType: nextStatus === "COMPLETED"
            ? streamlinedCheckout?.completionPendingPrint
              ? "CHECKOUT_PENDING_PRINT"
              : order.paymentStatus === "PAID" ? "ORDER_COMPLETED_AFTER_PREPAYMENT" : "CHECKOUT_COMPLETED"
            : "STAFF_STATUS_CHANGED",
          previousStatus: order.status,
          newStatus: persistedStatus,
          createdBy: authorization.principal.user.id,
        },
      });
      await persistExternalOrderTransition(
        transaction,
        externalTransition,
        persistedStatus,
      );
      return transaction.order.findUniqueOrThrow({
        where: { id: order.id },
        select: staffOrderSelect,
      });
    }), nextStatus === "COMPLETED" && order.paymentStatus === "UNPAID" ? 4 : 3);

    await timing.measureDb(() => recordAuditEvent({
      action: nextStatus === "COMPLETED"
        ? order.paymentStatus === "PAID" ? "ORDER_COMPLETED_AFTER_PREPAYMENT" : "CHECKOUT_COMPLETED"
        : "ORDER_STATUS_CHANGED",
      entityType: "ORDER",
      entityId: order.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
      metadata: {
        previousStatus: order.status,
        newStatus: persistedStatus,
        paymentMethod: checkout?.methodLabel ?? null,
        discount: checkout?.discountLabel ?? null,
        discountApprovedBy: checkout?.discountApprovedById ?? null,
        cancellationReason: cancellation?.cancellationReason ?? null,
        total: checkout?.total ?? null,
      },
    }));
    return NextResponse.json(
      {
        order: updatedOrder,
        completionPendingPrint: streamlinedCheckout?.completionPendingPrint ?? false,
      },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const checkoutResponse = checkoutErrorResponse(error, authorization.requestId);
    if (checkoutResponse) return checkoutResponse;
    if (!(error instanceof TransitionConflict)) throw error;
    return NextResponse.json(
      { error: "訂單已被其他人更新或確認期限已過，請重新整理。" },
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
      DISCOUNT_NOT_APPLICABLE: "此訂單沒有可套用折扣的商品。",
      INSUFFICIENT_CASH: "實收金額不可小於應收金額。",
    };
    const status = error.code === "PAYMENT_INVALID"
      || error.code === "DISCOUNT_DISABLED"
      || error.code === "DISCOUNT_INVALID"
      || error.code === "DISCOUNT_NOT_APPLICABLE" ? 409 : 400;
    return NextResponse.json({ error: messages[error.code] }, { status, headers });
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
