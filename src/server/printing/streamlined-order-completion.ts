import type {
  FulfillmentType,
  OrderItemStatus,
  OrderStatus,
  PrintJobStatus,
  Prisma,
} from "@prisma/client";

const streamlinedSourceStatuses = new Set<OrderStatus>([
  "CONFIRMED",
  "PREPARING",
  "PACKING",
  "READY",
]);

type StreamlinedCheckoutInput = {
  requestedStatus: OrderStatus;
  currentStatus: OrderStatus;
  fulfillmentType?: FulfillmentType;
  kdsModuleEnabled: boolean;
  printModuleEnabled: boolean;
  externalProvider: string | null;
  primaryPrintStatus: PrintJobStatus | null;
};

export type StreamlinedCheckoutPlan = {
  targetStatus: "READY" | "COMPLETED";
  itemStatus: Extract<OrderItemStatus, "READY" | "SERVED">;
  queuePrint: boolean;
  completionPendingPrint: boolean;
};

export function getStreamlinedCheckoutPlan(
  input: StreamlinedCheckoutInput,
): StreamlinedCheckoutPlan | null {
  if (
    input.requestedStatus !== "COMPLETED"
    || input.kdsModuleEnabled
    || input.externalProvider !== null
    || !streamlinedSourceStatuses.has(input.currentStatus)
  ) {
    return null;
  }

  const printed = input.primaryPrintStatus === "SUCCEEDED";
  const waitForPrint = input.printModuleEnabled && !printed;
  return {
    targetStatus: waitForPrint ? "READY" : "COMPLETED",
    itemStatus: input.fulfillmentType === "DINE_IN" ? "SERVED" : "READY",
    queuePrint: input.printModuleEnabled && input.primaryPrintStatus === null,
    completionPendingPrint: waitForPrint,
  };
}

export async function completeStreamlinedOrderAfterPrint(
  transaction: Prisma.TransactionClient,
  printJobId: string,
  now = new Date(),
) {
  const job = await transaction.printJob.findFirst({
    where: { id: printJobId, status: "SUCCEEDED" },
    select: {
      order: {
        select: {
          id: true,
          organizationId: true,
          stallId: true,
          status: true,
          source: true,
          externalProvider: true,
          fulfillmentType: true,
          pickupVerifiedAt: true,
          paymentStatus: true,
          stall: {
            select: {
              orderingSettings: {
                select: { kdsModuleEnabled: true, printModuleEnabled: true },
              },
            },
          },
        },
      },
    },
  });
  const order = job?.order;
  const settings = order?.stall.orderingSettings;
  if (
    !order
    || !settings
    || settings.kdsModuleEnabled
    || !settings.printModuleEnabled
    || order.externalProvider !== null
    || order.status !== "READY"
    || order.paymentStatus !== "PAID"
    || (
      order.source === "QR_MENU"
      && order.fulfillmentType === "TAKEOUT"
      && !order.pickupVerifiedAt
    )
  ) {
    return false;
  }

  const changed = await transaction.order.updateMany({
    where: { id: order.id, stallId: order.stallId, status: "READY", paymentStatus: "PAID" },
    data: { status: "COMPLETED", completedAt: now },
  });
  if (changed.count !== 1) return false;

  await transaction.orderEvent.create({
    data: {
      organizationId: order.organizationId,
      stallId: order.stallId,
      orderId: order.id,
      eventType: "ORDER_AUTO_COMPLETED_AFTER_PRINT",
      previousStatus: "READY",
      newStatus: "COMPLETED",
    },
  });
  return true;
}

export async function completeStreamlinedOrderAfterPickup(
  transaction: Prisma.TransactionClient,
  orderId: string,
  now = new Date(),
) {
  const order = await transaction.order.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      organizationId: true,
      stallId: true,
      status: true,
      source: true,
      externalProvider: true,
      fulfillmentType: true,
      pickupVerifiedAt: true,
      paymentStatus: true,
      printJobs: {
        where: { status: "SUCCEEDED" },
        select: { id: true },
        take: 1,
      },
      stall: {
        select: {
          orderingSettings: {
            select: { kdsModuleEnabled: true, printModuleEnabled: true },
          },
        },
      },
    },
  });
  const settings = order?.stall.orderingSettings;
  if (
    !order
    || !settings
    || settings.kdsModuleEnabled
    || order.externalProvider !== null
    || order.status !== "READY"
    || order.source !== "QR_MENU"
    || order.fulfillmentType !== "TAKEOUT"
    || !order.pickupVerifiedAt
    || order.paymentStatus !== "PAID"
    || (settings.printModuleEnabled && order.printJobs.length === 0)
  ) {
    return false;
  }

  const changed = await transaction.order.updateMany({
    where: {
      id: order.id,
      stallId: order.stallId,
      status: "READY",
      paymentStatus: "PAID",
      pickupVerifiedAt: { not: null },
    },
    data: { status: "COMPLETED", completedAt: now },
  });
  if (changed.count !== 1) return false;

  await transaction.orderEvent.create({
    data: {
      organizationId: order.organizationId,
      stallId: order.stallId,
      orderId: order.id,
      eventType: "ORDER_AUTO_COMPLETED_AFTER_PICKUP",
      previousStatus: "READY",
      newStatus: "COMPLETED",
    },
  });
  return true;
}
