import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { cancellationMatchesOrder, orderStatusUpdateSchema } from "@/lib/order-status-update";
import { prisma } from "@/lib/prisma";
import { canTransitionOrder, hasPermission } from "@/lib/rbac";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string; orderId: string }> };
class TransitionConflict extends Error {}

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
      { error: "您沒有現金結帳權限。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (nextStatus === "COMPLETED" && order.source === "QR_MENU" && !order.pickupVerifiedAt) {
    return NextResponse.json(
      { error: "請先驗證顧客的取餐碼。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
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
        },
      });
      if (changed.count !== 1) throw new TransitionConflict();

      if (nextStatus === "COMPLETED") {
        await transaction.payment.create({
          data: {
            organizationId: order.organizationId,
            stallId: order.stallId,
            orderId: order.id,
            amount: order.total,
            method: "CASH",
            status: "PAID",
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
          eventType: nextStatus === "COMPLETED" ? "CASH_CHECKOUT_COMPLETED" : "STAFF_STATUS_CHANGED",
          previousStatus: order.status,
          newStatus: nextStatus,
          createdBy: authorization.principal.user.id,
        },
      });
      return transaction.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true },
      });
    });

    await recordAuditEvent({
      action: nextStatus === "COMPLETED" ? "CASH_CHECKOUT_COMPLETED" : "ORDER_STATUS_CHANGED",
      entityType: "ORDER",
      entityId: order.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
      metadata: { previousStatus: order.status, newStatus: nextStatus },
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
