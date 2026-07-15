import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { calculateCheckout, paymentMethodForKind } from "@/lib/checkout";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { cancellationMatchesOrder, orderStatusUpdateSchema } from "@/lib/order-status-update";
import { staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { canTransitionOrder, hasPermission } from "@/lib/rbac";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string; orderId: string }> };
class TransitionConflict extends Error {}
class CheckoutValidationError extends Error {}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug, orderId } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "UPDATE_ORDERS");
  if (!authorization.ok) return authorization.response;

  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      action: "CSRF_VALIDATION_FAILED",
      entityType: "ORDER",
      entityId: orderId,
      outcome: "DENIED",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    });
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

  await prisma.$queryRaw`select public.expire_unconfirmed_orders()`;
  const order = await prisma.order.findFirst({
    where: { id: orderId, stallId: authorization.stall.id },
  });
  if (!order) {
    return NextResponse.json(
      { error: "找不到此訂單。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const nextStatus = parsed.data.status;
  if (
    nextStatus === "CANCELLED"
    && !cancellationMatchesOrder(parsed.data.confirmationOrderNo, order.orderNo)
  ) {
    await recordAuditEvent({
      action: "ORDER_CANCELLATION_CONFIRMATION_FAILED",
      entityType: "ORDER",
      entityId: order.id,
      outcome: "DENIED",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "取消確認資料與目前訂單不符，訂單未取消。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  if (!canTransitionOrder(order.status, nextStatus, authorization.role)) {
    return NextResponse.json(
      { error: "目前狀態不允許此操作。" },
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

  let checkout: null | {
    paymentOptionId: string | null;
    method: "CASH" | "MANUAL_TRANSFER" | "OTHER";
    methodLabel: string;
    discountOptionId: string | null;
    discountLabel: string | null;
    discountRateBps: number | null;
    discountAmount: number;
    total: number;
    cashReceived: number | null;
    changeAmount: number | null;
  } = null;

  if (nextStatus === "COMPLETED") {
    const incompleteItemCount = await prisma.orderItem.count({
      where: {
        orderId: order.id,
        stallId: order.stallId,
        status: order.fulfillmentType === "DINE_IN"
          ? { not: "SERVED" }
          : { notIn: ["READY", "SERVED"] },
      },
    });
    if (incompleteItemCount > 0) {
      return NextResponse.json(
        { error: order.fulfillmentType === "DINE_IN" ? "仍有餐點尚未出餐。" : "仍有餐點尚未完成製作。" },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }

    const settings = await prisma.stallOrderingSettings.findUnique({
      where: { stallId: order.stallId },
      select: { paymentModuleEnabled: true, discountModuleEnabled: true },
    });
    const paymentModuleEnabled = settings?.paymentModuleEnabled ?? false;
    const discountModuleEnabled = settings?.discountModuleEnabled ?? false;

    const requestedPaymentOptionId = parsed.data.paymentOptionId ?? null;
    if (paymentModuleEnabled && !requestedPaymentOptionId) {
      return NextResponse.json(
        { error: "請選擇付款方式。" },
        { status: 400, headers: { "x-request-id": authorization.requestId } },
      );
    }
    const paymentOption = requestedPaymentOptionId
      ? await prisma.paymentOption.findFirst({
          where: {
            id: requestedPaymentOptionId,
            stallId: order.stallId,
            organizationId: order.organizationId,
            isEnabled: true,
          },
          select: { id: true, name: true, kind: true },
        })
      : await prisma.paymentOption.findFirst({
          where: {
            stallId: order.stallId,
            organizationId: order.organizationId,
            kind: "CASH",
            isEnabled: true,
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, kind: true },
        });
    if (requestedPaymentOptionId && !paymentOption) {
      return NextResponse.json(
        { error: "付款方式已停用或不存在，請重新選擇。" },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }

    const requestedDiscountOptionId = parsed.data.discountOptionId ?? null;
    if (!discountModuleEnabled && requestedDiscountOptionId) {
      return NextResponse.json(
        { error: "此攤位尚未開啟折扣模組。" },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }
    const discount = requestedDiscountOptionId
      ? await prisma.discountOption.findFirst({
          where: {
            id: requestedDiscountOptionId,
            stallId: order.stallId,
            organizationId: order.organizationId,
            isEnabled: true,
          },
          select: { id: true, name: true, rateBps: true },
        })
      : null;
    if (requestedDiscountOptionId && !discount) {
      return NextResponse.json(
        { error: "折扣已停用或不存在，請重新選擇。" },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }

    const paymentKind = paymentOption?.kind ?? "CASH";
    try {
      const amounts = calculateCheckout(
        order.subtotal,
        discount?.rateBps ?? 10_000,
        paymentKind === "CASH" ? parsed.data.cashReceived : undefined,
      );
      checkout = {
        paymentOptionId: paymentOption?.id ?? null,
        method: paymentMethodForKind(paymentKind),
        methodLabel: paymentOption?.name ?? "現金",
        discountOptionId: discount?.id ?? null,
        discountLabel: discount?.name ?? null,
        discountRateBps: discount?.rateBps ?? null,
        discountAmount: amounts.discountAmount,
        total: amounts.total,
        cashReceived: paymentKind === "CASH" ? amounts.cashReceived : null,
        changeAmount: paymentKind === "CASH" ? amounts.changeAmount : null,
      };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "INSUFFICIENT_CASH") throw error;
      return NextResponse.json(
        { error: "實收金額不可小於應收金額。" },
        { status: 400, headers: { "x-request-id": authorization.requestId } },
      );
    }
  }

  const now = new Date();
  try {
    const updatedOrder = await prisma.$transaction(async (transaction) => {
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
          status: nextStatus,
          confirmedAt: nextStatus === "CONFIRMED" ? now : order.confirmedAt,
          completedAt: nextStatus === "COMPLETED" ? now : order.completedAt,
          paymentStatus: nextStatus === "COMPLETED" ? "PAID" : order.paymentStatus,
          paidAt: nextStatus === "COMPLETED" ? now : order.paidAt,
          discountOptionId: checkout?.discountOptionId,
          discountLabel: checkout?.discountLabel,
          discountRateBps: checkout?.discountRateBps,
          discountAmount: checkout?.discountAmount,
          total: checkout?.total,
        },
      });
      if (changed.count !== 1) throw new TransitionConflict();

      if (nextStatus === "COMPLETED") {
        if (!checkout) throw new CheckoutValidationError();
        await transaction.payment.create({
          data: {
            organizationId: order.organizationId,
            stallId: order.stallId,
            orderId: order.id,
            paymentOptionId: checkout.paymentOptionId,
            amount: checkout.total,
            method: checkout.method,
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
          eventType: nextStatus === "COMPLETED" ? "CHECKOUT_COMPLETED" : "STAFF_STATUS_CHANGED",
          previousStatus: order.status,
          newStatus: nextStatus,
          createdBy: authorization.principal.user.id,
        },
      });
      return transaction.order.findUniqueOrThrow({
        where: { id: order.id },
        select: staffOrderSelect,
      });
    });

    await recordAuditEvent({
      action: nextStatus === "COMPLETED" ? "CHECKOUT_COMPLETED" : "ORDER_STATUS_CHANGED",
      entityType: "ORDER",
      entityId: order.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
      metadata: {
        previousStatus: order.status,
        newStatus: nextStatus,
        paymentMethod: checkout?.methodLabel ?? null,
        discount: checkout?.discountLabel ?? null,
        total: checkout?.total ?? null,
      },
    });
    return NextResponse.json(
      { order: updatedOrder },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    if (!(error instanceof TransitionConflict)) throw error;
    return NextResponse.json(
      { error: "訂單已被其他人更新或確認期限已過，請重新整理。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
