import type {
  FulfillmentType,
  OrderItemStatus,
  OrderStatus,
  PaymentStatus,
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
  source: string;
  paymentStatus: PaymentStatus;
};

type QrPaymentOnlyInput = Pick<
  StreamlinedCheckoutInput,
  "requestedStatus" | "currentStatus" | "externalProvider" | "source" | "paymentStatus"
> & { completionIntent?: "COLLECT_PAYMENT" | "FINALIZE" };

export type StreamlinedCheckoutPlan = {
  targetStatus: "READY" | "COMPLETED";
  itemStatus: Extract<OrderItemStatus, "READY" | "SERVED">;
  queuePrint: boolean;
  completionPendingPrint: boolean;
};

export function shouldKeepQrOrderOpenAfterPayment(input: QrPaymentOnlyInput) {
  return input.requestedStatus === "COMPLETED"
    && input.completionIntent === "COLLECT_PAYMENT"
    && input.source === "QR_MENU"
    && input.paymentStatus === "UNPAID"
    && input.externalProvider === null
    && streamlinedSourceStatuses.has(input.currentStatus);
}

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
  const printCompletesOrder = input.source !== "QR_MENU";
  const waitForPrint = printCompletesOrder && input.printModuleEnabled && !printed;
  return {
    targetStatus: waitForPrint ? "READY" : "COMPLETED",
    itemStatus: input.fulfillmentType === "DINE_IN" ? "SERVED" : "READY",
    queuePrint: printCompletesOrder && input.printModuleEnabled && input.primaryPrintStatus === null,
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
    || order.source === "QR_MENU"
    || order.status !== "READY"
    || order.paymentStatus !== "PAID"
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
