import type { OrderItemStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { classifyStallOrderForProduction } from "@/lib/fulfillment-time";
import { canTransitionOrderItem, deriveOrderStatusFromItems } from "@/lib/order-item-status";
import { staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

const bulkItemStatusSchema = z.object({
  status: z.enum(["PREPARING", "READY", "SERVED"]),
}).strict();

type RouteContext = {
  params: Promise<{ stallSlug: string; orderId: string }>;
};

class BulkItemTransitionConflict extends Error {}

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
  const parsed = bulkItemStatusSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "批次餐點狀態格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const sourceStatus: OrderItemStatus = parsed.data.status === "PREPARING"
    ? "PENDING"
    : parsed.data.status === "READY" ? "PREPARING" : "READY";
  const now = new Date();
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`select id from public.orders where id = ${orderId}::uuid for update`;
      const order = await transaction.order.findFirst({
        where: { id: orderId, stallId: authorization.stall.id },
        include: {
          stall: {
            select: {
              timezone: true,
              orderingSettings: { select: { businessDayCutoffHour: true } },
            },
          },
          items: { select: { id: true, status: true } },
        },
      });
      if (!order) throw new BulkItemTransitionConflict("NOT_FOUND");
      if (parsed.data.status === "PREPARING"
        && order.status === "CONFIRMED"
        && classifyStallOrderForProduction(order).productionBlocked) {
        throw new BulkItemTransitionConflict("FULFILLMENT_TIME");
      }
      if (!["CONFIRMED", "PREPARING", "PACKING", "READY"].includes(order.status)) {
        throw new BulkItemTransitionConflict("ORDER_STATUS");
      }

      const eligibleItems = order.items.filter((item) => item.status === sourceStatus);
      if (eligibleItems.length === 0 || !eligibleItems.every((item) => (
        canTransitionOrderItem(item.status, parsed.data.status, authorization.role)
      ))) {
        throw new BulkItemTransitionConflict("ITEM_STATUS");
      }

      const eligibleIds = eligibleItems.map((item) => item.id);
      const changed = await transaction.orderItem.updateMany({
        where: {
          id: { in: eligibleIds },
          orderId: order.id,
          stallId: order.stallId,
          status: sourceStatus,
        },
        data: {
          status: parsed.data.status,
          preparingAt: parsed.data.status === "PREPARING" ? now : undefined,
          readyAt: parsed.data.status === "READY" ? now : undefined,
          servedAt: parsed.data.status === "SERVED" ? now : undefined,
        },
      });
      if (changed.count !== eligibleItems.length) {
        throw new BulkItemTransitionConflict("CONCURRENT_UPDATE");
      }

      const changedIds = new Set(eligibleIds);
      const itemStatuses = order.items.map((item) => (
        changedIds.has(item.id) ? parsed.data.status : item.status
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
          eventType: "ORDER_ITEMS_BULK_STATUS_CHANGED",
          previousStatus: order.status,
          newStatus: nextOrderStatus,
          createdBy: authorization.principal.user.id,
        },
      });
      return {
        count: changed.count,
        order: await transaction.order.findUniqueOrThrow({
          where: { id: order.id },
          select: staffOrderSelect,
        }),
      };
    });

    await recordAuditEvent({
      action: "ORDER_ITEMS_BULK_STATUS_CHANGED",
      entityType: "ORDER",
      entityId: orderId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
      metadata: { count: result.count, newStatus: parsed.data.status },
    });
    return NextResponse.json(
      { order: result.order, updatedItemCount: result.count },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    if (!(error instanceof BulkItemTransitionConflict)) throw error;
    const notFound = error.message === "NOT_FOUND";
    const productionNotDue = error.message === "FULFILLMENT_TIME";
    return NextResponse.json(
      {
        error: notFound
          ? "找不到此訂單。"
          : productionNotDue
            ? "此訂單的履約營業日尚未到，或履約時間尚未確認，暫時不能開始製作。"
            : "餐點已被其他人更新，請確認最新狀態。",
        ...(productionNotDue ? { code: "PRODUCTION_NOT_DUE" } : {}),
      },
      { status: notFound ? 404 : 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
