import type { OrderItemStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { fulfillmentTimeBlocksProduction } from "@/lib/fulfillment-time";
import { canTransitionOrderItem, deriveOrderStatusFromItems } from "@/lib/order-item-status";
import { staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

const itemStatusSchema = z.object({
  status: z.enum(["PREPARING", "READY", "SERVED"]),
}).strict();

type RouteContext = {
  params: Promise<{ stallSlug: string; orderId: string; itemId: string }>;
};

class ItemTransitionConflict extends Error {}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug, orderId, itemId } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "UPDATE_ORDERS");
  if (!authorization.ok) return authorization.response;

  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      action: "CSRF_VALIDATION_FAILED",
      entityType: "ORDER_ITEM",
      entityId: itemId,
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
  const parsed = itemStatusSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "餐點狀態格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const now = new Date();
  try {
    const updatedOrder = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`select id from public.orders where id = ${orderId}::uuid for update`;
      const order = await transaction.order.findFirst({
        where: { id: orderId, stallId: authorization.stall.id },
        include: { items: { select: { id: true, status: true } } },
      });
      if (!order) throw new ItemTransitionConflict("NOT_FOUND");
      if (parsed.data.status === "PREPARING" && fulfillmentTimeBlocksProduction(order.fulfillmentTimeState)) {
        throw new ItemTransitionConflict("FULFILLMENT_TIME");
      }
      if (!["CONFIRMED", "PREPARING", "PACKING", "READY"].includes(order.status)) {
        throw new ItemTransitionConflict("ORDER_STATUS");
      }

      const item = order.items.find((candidate) => candidate.id === itemId);
      if (!item || !canTransitionOrderItem(item.status, parsed.data.status, authorization.role)) {
        throw new ItemTransitionConflict("ITEM_STATUS");
      }

      const changed = await transaction.orderItem.updateMany({
        where: { id: item.id, orderId: order.id, stallId: order.stallId, status: item.status },
        data: {
          status: parsed.data.status,
          preparingAt: parsed.data.status === "PREPARING" ? now : undefined,
          readyAt: parsed.data.status === "READY" ? now : undefined,
          servedAt: parsed.data.status === "SERVED" ? now : undefined,
        },
      });
      if (changed.count !== 1) throw new ItemTransitionConflict("CONCURRENT_UPDATE");

      const itemStatuses = order.items.map((candidate) => (
        candidate.id === item.id ? parsed.data.status : candidate.status
      )) as OrderItemStatus[];
      const nextOrderStatus = deriveOrderStatusFromItems(order.status, itemStatuses);
      if (nextOrderStatus !== order.status) {
        await transaction.order.update({
          where: { id: order.id },
          data: { status: nextOrderStatus },
        });
      }

      await transaction.orderEvent.create({
        data: {
          organizationId: order.organizationId,
          stallId: order.stallId,
          orderId: order.id,
          eventType: "ORDER_ITEM_STATUS_CHANGED",
          previousStatus: order.status,
          newStatus: nextOrderStatus,
          createdBy: authorization.principal.user.id,
        },
      });
      return transaction.order.findUniqueOrThrow({
        where: { id: order.id },
        select: staffOrderSelect,
      });
    });

    await recordAuditEvent({
      action: "ORDER_ITEM_STATUS_CHANGED",
      entityType: "ORDER_ITEM",
      entityId: itemId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
      metadata: { orderId, newStatus: parsed.data.status },
    });
    return NextResponse.json(
      { order: updatedOrder },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    if (!(error instanceof ItemTransitionConflict)) throw error;
    const notFound = error.message === "NOT_FOUND";
    return NextResponse.json(
      { error: notFound ? "找不到此訂單。" : "餐點已被其他人更新，請確認最新狀態。" },
      { status: notFound ? 404 : 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
