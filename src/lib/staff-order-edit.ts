import "server-only";

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
  | "PRINT_ALREADY_STARTED"
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
  if (order.printJobs.some((job) => job.status !== "PENDING")) return "PRINT_ALREADY_STARTED";
  if (order.items.some((item) => !item.productId || item.noteOptions.some((option) => !option.noteOptionId))) {
    return "UNSUPPORTED_EXISTING_CONFIGURATION";
  }
  return null;
}

type AuditItem = {
  itemId: string | null;
  productId: string;
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
      const order = await transaction.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          orderNo: true,
          source: true,
          fulfillmentType: true,
          status: true,
          paymentStatus: true,
          note: true,
          discountAmount: true,
          discountOptionId: true,
          subtotal: true,
          total: true,
          payment: { select: { id: true } },
          printJobs: { select: { status: true } },
          items: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              productId: true,
              name: true,
              unitPrice: true,
              quantity: true,
              note: true,
              status: true,
              productionTask: { select: { status: true } },
              noteOptions: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                select: {
                  noteOptionId: true,
                  groupName: true,
                  optionName: true,
                  priceDelta: true,
                },
              },
            },
          },
        },
      });
      if (!order) throw new StaffOrderEditError("NOT_FOUND");
      const failure = getStaffOrderEditFailure(order);
      if (failure) throw new StaffOrderEditError(failure);
      const publicTakeoutOrder = order.source === "QR_MENU" && order.fulfillmentType === "TAKEOUT";
      if (publicTakeoutOrder && !input.request.publicAmendment) {
        throw new StaffOrderEditError("CUSTOMER_NOTICE_REQUIRED");
      }

      const byId = new Map(order.items.map((item) => [item.id, item]));
      const requestedItems = input.request.items.map((item) => {
        if (item.kind === "NEW") {
          return {
            productId: item.productId,
            quantity: item.quantity,
            note: item.note,
            noteOptionIds: item.noteOptionIds,
            bundleChoiceIds: item.bundleChoiceIds,
          };
        }
        const current = byId.get(item.itemId);
        if (!current?.productId) throw new StaffOrderEditError("ITEM_CONFLICT");
        return {
          productId: current.productId,
          quantity: item.quantity,
          note: current.note ?? "",
          noteOptionIds: current.noteOptions.map((option) => option.noteOptionId as string),
          bundleChoiceIds: [],
        };
      });

      const configurationKeys = requestedItems.map((item) => JSON.stringify([
        item.productId,
        item.note,
        [...item.noteOptionIds].sort(),
        [...item.bundleChoiceIds].sort(),
      ]));
      if (new Set(configurationKeys).size !== configurationKeys.length) {
        throw new StaffOrderEditError("ITEM_CONFLICT");
      }

      const prepared = await prepareStaffOrderItems(
        transaction,
        input.organizationId,
        input.stallId,
        { items: requestedItems, customerNote: order.note ?? "" },
      );
      const existingItemIds = input.request.items.map((item) => item.kind === "EXISTING" ? item.itemId : null);
      const beforeItems: AuditItem[] = order.items.map((item) => ({
        itemId: item.id,
        productId: item.productId as string,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.unitPrice * item.quantity,
        noteOptions: item.noteOptions.map((option) => `${option.groupName}:${option.optionName}`),
      }));
      const afterItems: AuditItem[] = prepared.items.map((item, index) => ({
        itemId: existingItemIds[index],
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.unitPrice * item.quantity,
        noteOptions: item.noteOptions.map((option) => `${option.groupName}:${option.optionName}`),
      }));

      const removedPrintJobs = await transaction.printJob.deleteMany({
        where: { orderId: order.id, status: "PENDING" },
      });
      if (removedPrintJobs.count !== order.printJobs.length) {
        throw new StaffOrderEditError("PRINT_ALREADY_STARTED");
      }

      const deleted = await transaction.orderItem.deleteMany({
        where: {
          orderId: order.id,
          stallId: input.stallId,
          status: "PENDING",
          OR: [
            { productionTask: null },
            { productionTask: { is: { status: "PENDING" } } },
          ],
        },
      });
      if (deleted.count !== order.items.length) throw new StaffOrderEditError("ORDER_ALREADY_STARTED");
      for (const [index, item] of prepared.items.entries()) {
        await transaction.orderItem.create({
          data: {
            organizationId: input.organizationId,
            stallId: input.stallId,
            orderId: order.id,
            productId: item.productId,
            sourceLineIndex: index,
            name: item.name,
            baseUnitPrice: item.baseUnitPrice,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            isOrderDiscountEligible: item.isOrderDiscountEligible,
            note: item.note,
            status: "PENDING",
            noteOptions: {
              create: item.noteOptions.map((option) => ({
                organizationId: input.organizationId,
                stallId: input.stallId,
                noteGroupId: option.noteGroupId,
                noteOptionId: option.noteOptionId,
                groupName: option.groupName,
                optionName: option.optionName,
                priceDelta: option.priceDelta,
                sortOrder: option.sortOrder,
              })),
            },
          },
        });
      }

      const changed = await transaction.order.updateMany({
        where: {
          id: order.id,
          stallId: input.stallId,
          status: order.status,
          paymentStatus: "UNPAID",
        },
        data: { subtotal: prepared.subtotal, total: prepared.subtotal },
      });
      if (changed.count !== 1) throw new StaffOrderEditError("ORDER_CONFLICT");

      const before = {
        subtotal: order.subtotal,
        total: order.total,
        items: beforeItems,
      } satisfies Prisma.InputJsonObject;
      const after = {
        subtotal: prepared.subtotal,
        total: prepared.subtotal,
        items: afterItems,
      } satisfies Prisma.InputJsonObject;
      const eventType = publicTakeoutOrder
        ? "PUBLIC_ORDER_ITEMS_ADJUSTED"
        : "STAFF_ORDER_ITEMS_EDITED";
      await transaction.orderEvent.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          orderId: order.id,
          eventType,
          previousStatus: order.status,
          newStatus: order.status,
          createdBy: input.actorProfileId,
          metadataJson: publicTakeoutOrder
            ? {
                before,
                after,
                reason: input.request.publicAmendment!.reason,
                customerMessage: input.request.publicAmendment!.customerMessage,
              }
            : { before, after },
        },
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof StaffOrderEditError || error instanceof StaffOrderCreateError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new StaffOrderEditError("ORDER_CONFLICT");
    }
    throw error;
  }
}
