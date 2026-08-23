import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { prepareStaffOrderItems, StaffOrderCreateError } from "@/lib/staff-order-create";
import type { UpdateTrackedPublicOrderInput } from "@/lib/public-order-edit-contract";
import { publicOrderCustomerDetailsCode } from "../../supabase/functions/_shared/schemas";

export type PublicOrderEditFailure =
  | "NOT_EDITABLE_SOURCE"
  | "PAYMENT_ALREADY_RECORDED"
  | "DISCOUNT_ALREADY_APPLIED"
  | "ORDER_ALREADY_CONFIRMED"
  | "ORDER_ALREADY_STARTED"
  | "PRINT_ALREADY_STARTED"
  | "INVALID_CUSTOMER_DETAILS"
  | "INVALID_DELIVERY_DETAILS"
  | "ORDER_CONFLICT"
  | "ORDER_NOT_FOUND";

export type PublicOrderEditEligibility = {
  source: string;
  status: string;
  paymentStatus: string;
  payment: { id: string } | null;
  discountAmount: number;
  discountOptionId: string | null;
  items: Array<{
    status: string;
    productionTask: { status: string } | null;
  }>;
  printJobs: Array<{ status: string }>;
};

const editableSources = new Set(["QR_MENU", "LINE_DELIVERY"]);

export class PublicOrderEditError extends Error {
  constructor(public readonly code: PublicOrderEditFailure) {
    super(code);
  }
}

export function getPublicOrderEditFailure(order: PublicOrderEditEligibility): PublicOrderEditFailure | null {
  if (!editableSources.has(order.source)) return "NOT_EDITABLE_SOURCE";
  if (order.paymentStatus !== "UNPAID" || order.payment) return "PAYMENT_ALREADY_RECORDED";
  if (order.discountAmount !== 0 || order.discountOptionId) return "DISCOUNT_ALREADY_APPLIED";
  if (order.status !== "WAITING_CONFIRMATION" && order.status !== "CONFIRMED") return "ORDER_ALREADY_STARTED";
  if (order.items.some((item) => item.status !== "PENDING" || (item.productionTask && item.productionTask.status !== "PENDING"))) {
    return "ORDER_ALREADY_STARTED";
  }
  if (order.printJobs.some((job) => job.status !== "PENDING")) return "PRINT_ALREADY_STARTED";
  return null;
}

export function getPublicOrderCancelFailure(order: PublicOrderEditEligibility): PublicOrderEditFailure | null {
  const editFailure = getPublicOrderEditFailure(order);
  if (editFailure) return editFailure;
  return order.status === "WAITING_CONFIRMATION" ? null : "ORDER_ALREADY_CONFIRMED";
}

export async function editTrackedPublicOrder(input: {
  orderId: string;
  request: UpdateTrackedPublicOrderInput;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        select id from public.orders where id = ${input.orderId}::uuid for update
      `);
      if (locked.length !== 1) throw new PublicOrderEditError("ORDER_NOT_FOUND");

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
          organizationId: true,
          stallId: true,
          source: true,
          status: true,
          fulfillmentType: true,
          paymentStatus: true,
          payment: { select: { id: true } },
          discountAmount: true,
          discountOptionId: true,
          subtotal: true,
          total: true,
          note: true,
          scheduledPickupAt: true,
          items: {
            select: {
              id: true,
              status: true,
              productionTask: { select: { status: true } },
            },
          },
          printJobs: { select: { id: true, status: true } },
        },
      });
      if (!order) throw new PublicOrderEditError("ORDER_NOT_FOUND");
      const failure = getPublicOrderEditFailure(order);
      if (failure) throw new PublicOrderEditError(failure);
      const customerDetailsFailure = publicOrderCustomerDetailsCode(
        input.request,
        order.fulfillmentType,
      );
      if (customerDetailsFailure) throw new PublicOrderEditError(customerDetailsFailure);

      const prepared = await prepareStaffOrderItems(
        transaction,
        order.organizationId,
        order.stallId,
        { items: input.request.items, customerNote: input.request.customerNote },
      );
      const previousStatus = order.status;
      const previousItems = order.items.length;

      const removedPrintJobs = await transaction.printJob.deleteMany({
        where: { orderId: order.id, status: "PENDING" },
      });
      if (removedPrintJobs.count !== order.printJobs.length) {
        throw new PublicOrderEditError("PRINT_ALREADY_STARTED");
      }

      const deletedItems = await transaction.orderItem.deleteMany({
        where: {
          orderId: order.id,
          status: "PENDING",
          OR: [
            { productionTask: null },
            { productionTask: { is: { status: "PENDING" } } },
          ],
        },
      });
      if (deletedItems.count !== previousItems) throw new PublicOrderEditError("ORDER_ALREADY_STARTED");

      for (const [index, item] of prepared.items.entries()) {
        await transaction.orderItem.create({
          data: {
            organizationId: order.organizationId,
            stallId: order.stallId,
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
                organizationId: order.organizationId,
                stallId: order.stallId,
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

      const now = new Date();
      const confirmationExpiresAt = order.scheduledPickupAt
        ?? new Date(now.getTime() + prepared.settings.unconfirmedOrderTimeoutSeconds * 1_000);
      const updated = await transaction.order.updateMany({
        where: {
          id: order.id,
          status: previousStatus,
          paymentStatus: "UNPAID",
        },
        data: {
          status: "WAITING_CONFIRMATION",
          confirmedAt: null,
          confirmationExpiresAt,
          customerName: input.request.customerName,
          customerPhone: input.request.customerPhone || null,
          deliveryAddress: order.fulfillmentType === "DELIVERY"
            ? input.request.deliveryAddress
            : null,
          note: input.request.customerNote || null,
          subtotal: prepared.subtotal,
          total: prepared.subtotal,
        },
      });
      if (updated.count !== 1) throw new PublicOrderEditError("ORDER_CONFLICT");

      await transaction.orderEvent.create({
        data: {
          organizationId: order.organizationId,
          stallId: order.stallId,
          orderId: order.id,
          eventType: "PUBLIC_ORDER_ITEMS_EDITED",
          previousStatus,
          newStatus: "WAITING_CONFIRMATION",
          metadataJson: {
            idempotencyKey: input.request.idempotencyKey,
            previousSubtotal: order.subtotal,
            previousTotal: order.total,
            previousItemCount: previousItems,
            subtotal: prepared.subtotal,
            total: prepared.subtotal,
            itemCount: prepared.items.length,
            removedPendingPrintJobCount: removedPrintJobs.count,
            merchantReconfirmationRequired: previousStatus === "CONFIRMED",
          },
        },
      });
      await transaction.$queryRaw(Prisma.sql`
        select public.refresh_stall_capacity(${order.stallId}::uuid, true, 'PUBLIC_ORDER_ITEMS_EDITED')
      `);

      return {
        orderStatus: "WAITING_CONFIRMATION" as const,
        merchantReconfirmationRequired: previousStatus === "CONFIRMED",
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PublicOrderEditError || error instanceof StaffOrderCreateError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new PublicOrderEditError("ORDER_CONFLICT");
    }
    throw error;
  }
}

export async function cancelTrackedPublicOrder(orderId: string) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        select id from public.orders where id = ${orderId}::uuid for update
      `);
      if (locked.length !== 1) throw new PublicOrderEditError("ORDER_NOT_FOUND");

      const order = await transaction.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          organizationId: true,
          stallId: true,
          source: true,
          status: true,
          paymentStatus: true,
          payment: { select: { id: true } },
          discountAmount: true,
          discountOptionId: true,
          items: { select: { status: true, productionTask: { select: { status: true } } } },
          printJobs: { select: { status: true } },
        },
      });
      if (!order) throw new PublicOrderEditError("ORDER_NOT_FOUND");
      const failure = getPublicOrderCancelFailure(order);
      if (failure) throw new PublicOrderEditError(failure);

      const now = new Date();
      const updated = await transaction.order.updateMany({
        where: { id: order.id, status: "WAITING_CONFIRMATION", paymentStatus: "UNPAID" },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancellationReason: "CUSTOMER_CANCELLED",
          cancellationDetail: "CUSTOMER_SELF_SERVICE_BEFORE_CONFIRMATION",
        },
      });
      if (updated.count !== 1) throw new PublicOrderEditError("ORDER_CONFLICT");

      await transaction.orderEvent.create({
        data: {
          organizationId: order.organizationId,
          stallId: order.stallId,
          orderId: order.id,
          eventType: "PUBLIC_ORDER_CANCELLED_BY_CUSTOMER",
          previousStatus: "WAITING_CONFIRMATION",
          newStatus: "CANCELLED",
          metadataJson: { channel: "PUBLIC_TRACKING" },
        },
      });
      await transaction.$queryRaw(Prisma.sql`
        select public.refresh_stall_capacity(${order.stallId}::uuid, true, 'PUBLIC_ORDER_CANCELLED_BY_CUSTOMER')
      `);
      return { orderStatus: "CANCELLED" as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PublicOrderEditError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new PublicOrderEditError("ORDER_CONFLICT");
    }
    throw error;
  }
}
