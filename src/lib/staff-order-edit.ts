import "server-only";
import { createHash } from "node:crypto";
import { orderItemsExceedLimits } from "@/lib/order-item-limits";
import { freezeOrderPrintDocuments, queueOrderAmendmentPrints } from "@/server/printing/order-amendment-print";
import { isOrderStockError } from "@/lib/order-stock-error";

import { Prisma } from "@prisma/client";
import {
  prepareStaffOrderItems,
  StaffOrderCreateError,
} from "@/lib/staff-order-create";
import type { UpdateStaffOrderItemsInput } from "@/lib/staff-order-edit-contract";
import { serializeStaffOrder, staffOrderSelect } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export type StaffOrderEditFailure =
  | "NOT_FOUND"
  | "NOT_EDITABLE_SOURCE"
  | "CUSTOMER_NOTICE_REQUIRED"
  | "PAYMENT_ALREADY_RECORDED"
  | "ORDER_ALREADY_STARTED"
  | "UNSUPPORTED_EXISTING_CONFIGURATION"
  | "ITEM_CONFLICT"
  | "ORDER_CONFLICT";

export class StaffOrderEditError extends Error {
  constructor(public readonly code: StaffOrderEditFailure) {
    super(code);
  }
}

type EligibilityOrder = {
  source: string;
  fulfillmentType: string;
  status: string;
  paymentStatus: string;
  payment: { id: string } | null;
  discountAmount: number;
  discountOptionId: string | null;
  items: Array<{
    status: string;
    productId: string | null;
    productionTask: { status: string } | null;
    noteOptions: Array<{ noteOptionId: string | null }>;
  }>;
  printJobs: Array<{ status: string }>;
};

export function getStaffOrderEditFailure(order: EligibilityOrder): StaffOrderEditFailure | null {
  const staffOrder = order.source === "STAFF_POS";
  const publicTakeoutOrder = order.source === "QR_MENU" && order.fulfillmentType === "TAKEOUT";
  if (!staffOrder && !publicTakeoutOrder) return "NOT_EDITABLE_SOURCE";
  if (
    (staffOrder && order.status !== "CONFIRMED")
    || (publicTakeoutOrder && order.status !== "WAITING_CONFIRMATION" && order.status !== "CONFIRMED")
  ) return "ORDER_ALREADY_STARTED";
  if (order.paymentStatus !== "UNPAID" || order.payment) return "PAYMENT_ALREADY_RECORDED";
  if (
    order.items.some((item) => (
      item.status !== "PENDING"
      || (item.productionTask && item.productionTask.status !== "PENDING")
    ))
  ) return "ORDER_ALREADY_STARTED";
  if (order.discountAmount !== 0 || order.discountOptionId) return "PAYMENT_ALREADY_RECORDED";
  return null;
}

type AuditItem = {
  itemId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  noteOptions: string[];
};

export type StaffOrderEditResult = {
  order: ReturnType<typeof serializeStaffOrder>;
  before: Prisma.InputJsonObject;
  after: Prisma.InputJsonObject;
  eventType: "STAFF_ORDER_ITEMS_EDITED" | "PUBLIC_ORDER_ITEMS_ADJUSTED";
};

export async function editStaffOrderItems(input: {
  organizationId: string;
  stallId: string;
  orderId: string;
  actorProfileId: string;
  request: UpdateStaffOrderItemsInput;
}): Promise<StaffOrderEditResult> {
  try {
    return await prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        select id
        from public.orders
        where id = ${input.orderId}::uuid
          and stall_id = ${input.stallId}::uuid
          and organization_id = ${input.organizationId}::uuid
        for update
      `);
      if (locked.length !== 1) throw new StaffOrderEditError("NOT_FOUND");

      await transaction.$queryRaw(Prisma.sql`
        select id from public.order_items where order_id = ${input.orderId}::uuid order by id for update
      `);
      await transaction.$queryRaw(Prisma.sql`
        select id from public.order_production_tasks where order_id = ${input.orderId}::uuid order by id for update
      `);
      await transaction.$queryRaw(Prisma.sql`
        select id from public.print_jobs where order_id = ${input.orderId}::uuid order by id for update
      `);
      const requestHash = createHash("sha256").update(JSON.stringify(input.request)).digest("hex");
      const prior = await transaction.orderEvent.findUnique({ where: { id: input.request.changeId } });
      if (prior) {
        const metadata = prior.metadataJson as { requestHash?: string; before?: Prisma.InputJsonObject; after?: Prisma.InputJsonObject } | null;
        if (prior.orderId !== input.orderId || prior.organizationId !== input.organizationId
          || prior.stallId !== input.stallId || prior.createdBy !== input.actorProfileId
          || metadata?.requestHash !== requestHash || !metadata.before || !metadata.after) throw new StaffOrderEditError("ORDER_CONFLICT");
        const current = await transaction.order.findUniqueOrThrow({ where: { id: input.orderId }, select: staffOrderSelect });
        return { order: serializeStaffOrder(current), before: metadata.before, after: metadata.after,
          eventType: prior.eventType as StaffOrderEditResult["eventType"] };
      }
      const itemSelect = {
        id: true, productId: true, sourceLineIndex: true, name: true, baseUnitPrice: true,
        unitPrice: true, quantity: true, note: true, status: true, promotionSource: true,
        isOrderDiscountEligible: true,
        product: { select: { categoryId: true, groupId: true } },
        productionTask: { select: { status: true } },
        noteOptions: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { noteGroupId: true, noteOptionId: true, groupName: true, optionName: true, priceDelta: true, sortOrder: true },
        },
      } satisfies Prisma.OrderItemSelect;
      const order = await transaction.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true, orderNo: true, source: true, origin: true, fulfillmentType: true,
          status: true, paymentStatus: true, note: true, discountAmount: true,
          discountOptionId: true, subtotal: true, total: true, updatedAt: true,
          payment: { select: { id: true } }, printJobs: { select: { status: true } },
          items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: itemSelect },
        },
      });
      if (!order) throw new StaffOrderEditError("NOT_FOUND");
      if (order.updatedAt.getTime() !== new Date(input.request.expectedUpdatedAt).getTime()) throw new StaffOrderEditError("ORDER_CONFLICT");
      const failure = getStaffOrderEditFailure(order);
      if (failure) throw new StaffOrderEditError(failure);
      const publicTakeoutOrder = order.source === "QR_MENU" && order.fulfillmentType === "TAKEOUT";
      if (publicTakeoutOrder && !input.request.publicAmendment) throw new StaffOrderEditError("CUSTOMER_NOTICE_REQUIRED");
      const eventType = publicTakeoutOrder ? "PUBLIC_ORDER_ITEMS_ADJUSTED" : "STAFF_ORDER_ITEMS_EDITED";
      const byId = new Map(order.items.map((item) => [item.id, item]));
      const requestedExisting = input.request.items.filter((item) => item.kind === "EXISTING");
      if (requestedExisting.some((item) => !byId.has(item.itemId))
        || new Set(requestedExisting.map((item) => item.itemId)).size !== requestedExisting.length) throw new StaffOrderEditError("ITEM_CONFLICT");
      const kept = new Map(requestedExisting.map((item) => [item.itemId, item.quantity]));
      const requestedNew = input.request.items.filter((item) => item.kind === "NEW");
      const unchanged = !requestedNew.length && kept.size === order.items.length
        && order.items.every((item) => kept.get(item.id) === item.quantity);
      const snapshot = (items: typeof order.items, subtotal: number) => ({
        subtotal, total: subtotal,
        items: items.map((item): AuditItem => ({ itemId: item.id, productId: item.productId,
          name: item.name, quantity: item.quantity, unitPrice: item.unitPrice,
          lineTotal: item.unitPrice * item.quantity,
          noteOptions: [...item.noteOptions.map((option) => option.groupName + ":" + option.optionName), ...(item.note ? [item.note] : [])],
        })),
      } satisfies Prisma.InputJsonObject);
      const before = snapshot(order.items, order.subtotal);
      if (unchanged) {
        const current = await transaction.order.findUniqueOrThrow({ where: { id: order.id }, select: staffOrderSelect });
        return { order: serializeStaffOrder(current), before, after: before, eventType };
      }
      // Existing snapshots keep their price and customization even if the catalog has changed.
      // Activity rewards have separate entitlement rules and cannot be repriced here.
      if (order.items.some((item) => item.promotionSource !== "NONE")) throw new StaffOrderEditError("UNSUPPORTED_EXISTING_CONFIGURATION");
      const prepared = await prepareStaffOrderItems(transaction, input.organizationId, input.stallId, {
        items: requestedNew, customerNote: order.note ?? "",
      });
      const finalLimitItems = [
        ...requestedExisting.map((item) => { const original = byId.get(item.itemId)!;
          return { productId: original.productId ?? original.id, quantity: item.quantity, note: original.note ?? "" }; }),
        ...requestedNew,
      ];
      if (orderItemsExceedLimits(finalLimitItems, order.note ?? "", prepared.settings)) throw new StaffOrderCreateError("ORDER_LIMIT_EXCEEDED");
      const increased = requestedExisting.filter((item) => item.quantity > byId.get(item.itemId)!.quantity);
      if (increased.length) {
        if (increased.some((item) => !byId.get(item.itemId)!.productId)) throw new StaffOrderEditError("ITEM_CONFLICT");
        const productIds = [...new Set(increased.map((item) => byId.get(item.itemId)!.productId!))];
        const now = new Date();
        const available = await transaction.stallProduct.count({ where: {
          organizationId: input.organizationId, stallId: input.stallId, productId: { in: productIds }, isEnabled: true,
          product: { isActive: true, category: { isActive: true } },
          AND: [{ OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] }, { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] }],
        } });
        if (available !== productIds.length) throw new StaffOrderCreateError("PRODUCT_UNAVAILABLE");
      }
      const originalJobs = await freezeOrderPrintDocuments(transaction, order.id);
      const removedIds = order.items.filter((item) => !kept.has(item.id)).map((item) => item.id);
      if (removedIds.length) {
        const removed = await transaction.orderItem.deleteMany({ where: {
          id: { in: removedIds }, orderId: order.id, stallId: input.stallId, status: "PENDING",
          OR: [{ productionTask: null }, { productionTask: { is: { status: "PENDING" } } }],
        } });
        if (removed.count !== removedIds.length) throw new StaffOrderEditError("ORDER_ALREADY_STARTED");
      }
      for (const item of requestedExisting) {
        if (byId.get(item.itemId)!.quantity === item.quantity) continue;
        const changed = await transaction.orderItem.updateMany({ where: { id: item.itemId, orderId: order.id, status: "PENDING",
          OR: [{ productionTask: null }, { productionTask: { is: { status: "PENDING" } } }],
        }, data: { quantity: item.quantity } });
        if (changed.count !== 1) throw new StaffOrderEditError("ORDER_ALREADY_STARTED");
      }
      const usedLineIndexes = new Set(order.items.filter((item) => kept.has(item.id)).map((item) => item.sourceLineIndex));
      for (const item of prepared.items) {
        const sourceLineIndex = Array.from({ length: 100 }, (_, index) => index + 1).find((index) => !usedLineIndexes.has(index));
        if (sourceLineIndex === undefined) throw new StaffOrderCreateError("ORDER_LIMIT_EXCEEDED");
        usedLineIndexes.add(sourceLineIndex);
        await transaction.orderItem.create({ data: {
          organizationId: input.organizationId, stallId: input.stallId, orderId: order.id,
          productId: item.productId, sourceLineIndex,
          name: item.name, baseUnitPrice: item.baseUnitPrice, unitPrice: item.unitPrice,
          quantity: item.quantity, isOrderDiscountEligible: item.isOrderDiscountEligible, note: item.note, status: "PENDING",
          noteOptions: { create: item.noteOptions.map((option) => ({ organizationId: input.organizationId, stallId: input.stallId, ...option })) },
        } });
      }
      const finalItems = await transaction.orderItem.findMany({ where: { orderId: order.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: itemSelect });
      const subtotal = finalItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const changed = await transaction.order.updateMany({ where: { id: order.id, stallId: input.stallId, status: order.status, paymentStatus: "UNPAID" }, data: { subtotal, total: subtotal } });
      if (changed.count !== 1) throw new StaffOrderEditError("ORDER_CONFLICT");
      const after = snapshot(finalItems, subtotal);
      const number = 1 + await transaction.orderEvent.count({ where: { orderId: order.id, eventType: { in: ["STAFF_ORDER_ITEMS_EDITED", "PUBLIC_ORDER_ITEMS_ADJUSTED"] } } });
      await transaction.orderEvent.create({ data: {
        id: input.request.changeId, organizationId: input.organizationId, stallId: input.stallId, orderId: order.id,
        eventType, previousStatus: order.status, newStatus: order.status, createdBy: input.actorProfileId,
        metadataJson: { before, after, requestHash, amendmentNumber: number,
          ...(publicTakeoutOrder ? { reason: input.request.publicAmendment!.reason, customerMessage: input.request.publicAmendment!.customerMessage } : {}),
        },
      } });
      await queueOrderAmendmentPrints(transaction, {
        organizationId: input.organizationId, stallId: input.stallId, actorProfileId: input.actorProfileId,
        amendmentId: input.request.changeId, number, originalJobs, before: order.items, after: finalItems,
        order: { ...order, total: subtotal },
      });
      await transaction.$queryRaw(Prisma.sql`
        select public.refresh_stall_capacity(${input.stallId}::uuid, true, ${eventType})
      `);

      const updated = await transaction.order.findUnique({
        where: { id: order.id },
        select: staffOrderSelect,
      });
      if (!updated) throw new StaffOrderEditError("ORDER_CONFLICT");
      return { order: serializeStaffOrder(updated), before, after, eventType };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
  } catch (error) {
    if (error instanceof StaffOrderEditError || error instanceof StaffOrderCreateError) throw error;
    if (isOrderStockError(error)) throw new StaffOrderCreateError("PRODUCT_STOCK_INSUFFICIENT");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new StaffOrderEditError("ORDER_CONFLICT");
    }
    throw error;
  }
}
