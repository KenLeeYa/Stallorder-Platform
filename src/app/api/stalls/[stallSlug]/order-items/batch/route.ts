import { Prisma, type OrderItemStatus } from "@prisma/client";
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

const uuid = z.string().uuid();
const commandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("UPDATE"),
    itemIds: z.array(uuid).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
    status: z.enum(["PREPARING", "READY", "SERVED"]),
  }).strict(),
  z.object({ operation: z.literal("UNDO"), actionId: uuid }).strict(),
]);

type RouteContext = { params: Promise<{ stallSlug: string }> };
type ItemSnapshot = {
  itemId: string;
  orderId: string;
  previousStatus: OrderItemStatus;
  preparingAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
};

class BatchConflict extends Error {}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "UPDATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = commandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "批次餐點操作格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = parsed.data.operation === "UPDATE"
      ? await applyBatchUpdate(parsed.data.itemIds, parsed.data.status, authorization)
      : await undoBatchUpdate(parsed.data.actionId, authorization);

    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: parsed.data.operation === "UPDATE" ? "ORDER_ITEMS_SELECTED_BATCH_CHANGED" : "ORDER_ITEMS_SELECTED_BATCH_UNDONE",
      entityType: "ORDER_ITEM_BATCH",
      entityId: result.actionId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { itemCount: result.itemCount, operation: parsed.data.operation },
    });
    return NextResponse.json(result, { headers: { "x-request-id": authorization.requestId } });
  } catch (error) {
    if (!(error instanceof BatchConflict)) throw error;
    const expired = error.message === "UNDO_EXPIRED";
    const notFound = error.message === "NOT_FOUND";
    return NextResponse.json(
      { error: expired ? "復原期限已過，請依最新餐點狀態操作。" : notFound ? "找不到可操作的餐點。" : "餐點已被其他人更新，請確認最新狀態。" },
      { status: notFound ? 404 : 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

type Authorization = Extract<Awaited<ReturnType<typeof authorizeApiRequest>>, { ok: true }>;

async function applyBatchUpdate(
  itemIds: string[],
  targetStatus: "PREPARING" | "READY" | "SERVED",
  authorization: Authorization,
) {
  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    const ids = Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`));
    await transaction.$queryRaw(Prisma.sql`
      select id from public.order_items where id in (${ids}) for update
    `);
    const items = await transaction.orderItem.findMany({
      where: { id: { in: itemIds }, stallId: authorization.stall.id },
      select: {
        id: true,
        orderId: true,
        status: true,
        preparingAt: true,
        readyAt: true,
        servedAt: true,
        order: { select: { status: true, fulfillmentTimeState: true } },
      },
    });
    if (items.length !== itemIds.length) throw new BatchConflict("NOT_FOUND");
    if (items.some((item) => (targetStatus === "PREPARING"
      && fulfillmentTimeBlocksProduction(item.order.fulfillmentTimeState))
      || !["CONFIRMED", "PREPARING", "PACKING", "READY"].includes(item.order.status)
      || !canTransitionOrderItem(item.status, targetStatus, authorization.role))) {
      throw new BatchConflict("INVALID_TRANSITION");
    }

    const snapshots: ItemSnapshot[] = items.map((item) => ({
      itemId: item.id,
      orderId: item.orderId,
      previousStatus: item.status,
      preparingAt: item.preparingAt?.toISOString() ?? null,
      readyAt: item.readyAt?.toISOString() ?? null,
      servedAt: item.servedAt?.toISOString() ?? null,
    }));
    for (const item of items) {
      const changed = await transaction.orderItem.updateMany({
        where: { id: item.id, stallId: authorization.stall.id, status: item.status },
        data: {
          status: targetStatus,
          preparingAt: targetStatus === "PREPARING" ? now : undefined,
          readyAt: targetStatus === "READY" ? now : undefined,
          servedAt: targetStatus === "SERVED" ? now : undefined,
        },
      });
      if (changed.count !== 1) throw new BatchConflict("CONCURRENT_UPDATE");
    }

    const orderIds = [...new Set(items.map((item) => item.orderId))];
    await refreshOrderStatuses(transaction, orderIds, authorization.principal.user.id);
    const action = await transaction.orderItemBatchAction.create({
      data: {
        organizationId: authorization.stall.organizationId,
        stallId: authorization.stall.id,
        actorProfileId: authorization.principal.user.id,
        targetStatus,
        itemSnapshots: snapshots,
        expiresAt: new Date(now.getTime() + 5_000),
      },
      select: { id: true, expiresAt: true },
    });
    return {
      actionId: action.id,
      undoExpiresAt: action.expiresAt.toISOString(),
      itemCount: items.length,
      orders: await transaction.order.findMany({
        where: { id: { in: orderIds }, stallId: authorization.stall.id },
        orderBy: { createdAt: "asc" },
        select: staffOrderSelect,
      }),
    };
  });
}

async function undoBatchUpdate(actionId: string, authorization: Authorization) {
  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select id from public.order_item_batch_actions where id = ${actionId}::uuid for update
    `;
    const action = await transaction.orderItemBatchAction.findFirst({
      where: {
        id: actionId,
        stallId: authorization.stall.id,
        actorProfileId: authorization.principal.user.id,
        undoneAt: null,
      },
    });
    if (!action) throw new BatchConflict("NOT_FOUND");
    if (action.expiresAt <= now) throw new BatchConflict("UNDO_EXPIRED");
    const snapshots = parseSnapshots(action.itemSnapshots);
    if (!snapshots) throw new BatchConflict("INVALID_SNAPSHOT");

    const itemIds = snapshots.map((snapshot) => snapshot.itemId);
    const ids = Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`));
    await transaction.$queryRaw(Prisma.sql`
      select id from public.order_items where id in (${ids}) for update
    `);
    const currentItems = await transaction.orderItem.findMany({
      where: { id: { in: itemIds }, stallId: authorization.stall.id },
      select: { id: true, status: true },
    });
    if (currentItems.length !== snapshots.length
      || currentItems.some((item) => item.status !== action.targetStatus)) {
      throw new BatchConflict("CONCURRENT_UPDATE");
    }

    for (const snapshot of snapshots) {
      await transaction.orderItem.update({
        where: { id: snapshot.itemId },
        data: {
          status: snapshot.previousStatus,
          preparingAt: snapshot.preparingAt ? new Date(snapshot.preparingAt) : null,
          readyAt: snapshot.readyAt ? new Date(snapshot.readyAt) : null,
          servedAt: snapshot.servedAt ? new Date(snapshot.servedAt) : null,
        },
      });
    }
    const orderIds = [...new Set(snapshots.map((snapshot) => snapshot.orderId))];
    await refreshOrderStatuses(transaction, orderIds, authorization.principal.user.id, "ORDER_ITEMS_BATCH_UNDONE");
    await transaction.orderItemBatchAction.update({ where: { id: action.id }, data: { undoneAt: now } });
    return {
      actionId: action.id,
      undoExpiresAt: action.expiresAt.toISOString(),
      itemCount: snapshots.length,
      orders: await transaction.order.findMany({
        where: { id: { in: orderIds }, stallId: authorization.stall.id },
        orderBy: { createdAt: "asc" },
        select: staffOrderSelect,
      }),
    };
  });
}

async function refreshOrderStatuses(
  transaction: Prisma.TransactionClient,
  orderIds: string[],
  actorProfileId: string,
  eventType = "ORDER_ITEMS_SELECTED_BATCH_CHANGED",
) {
  for (const orderId of orderIds) {
    const order = await transaction.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, organizationId: true, stallId: true, status: true, items: { select: { status: true } } },
    });
    const nextStatus = deriveOrderStatusFromItems(order.status, order.items.map((item) => item.status));
    if (nextStatus !== order.status) {
      await transaction.order.update({ where: { id: order.id }, data: { status: nextStatus } });
    }
    await transaction.orderEvent.create({
      data: {
        organizationId: order.organizationId,
        stallId: order.stallId,
        orderId: order.id,
        eventType,
        previousStatus: order.status,
        newStatus: nextStatus,
        createdBy: actorProfileId,
      },
    });
  }
}

function parseSnapshots(value: Prisma.JsonValue): ItemSnapshot[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const statuses = new Set<OrderItemStatus>(["PENDING", "PREPARING", "READY", "SERVED"]);
  const snapshots: ItemSnapshot[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const snapshot = entry as Record<string, unknown>;
    if (typeof snapshot.itemId !== "string" || typeof snapshot.orderId !== "string"
      || typeof snapshot.previousStatus !== "string" || !statuses.has(snapshot.previousStatus as OrderItemStatus)) return null;
    snapshots.push({
      itemId: snapshot.itemId,
      orderId: snapshot.orderId,
      previousStatus: snapshot.previousStatus as OrderItemStatus,
      preparingAt: typeof snapshot.preparingAt === "string" ? snapshot.preparingAt : null,
      readyAt: typeof snapshot.readyAt === "string" ? snapshot.readyAt : null,
      servedAt: typeof snapshot.servedAt === "string" ? snapshot.servedAt : null,
    });
  }
  return snapshots;
}
