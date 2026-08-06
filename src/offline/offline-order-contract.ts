import { z } from "zod";
import { OFFLINE_APP_PROTOCOL_VERSION } from "@/offline/offline-contract";

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const money = z.number().int().min(0).max(100_000_000);
const shortText = z.string().trim().max(120);
const noteText = z.string().trim().max(1_000);

export const offlineOrderStates = [
  "LOCAL_NEW",
  "LOCAL_CONFIRMED",
  "LOCAL_PREPARING",
  "LOCAL_READY",
  "LOCAL_COMPLETED",
  "LOCAL_CANCELLED",
] as const;

export type OfflineOrderState = (typeof offlineOrderStates)[number];

export const offlinePaymentMethods = [
  "CASH",
  "MANUAL_LINE_PAY",
  "MANUAL_JKOPAY",
  "OTHER_MANUAL",
] as const;

export type OfflinePaymentMethod = (typeof offlinePaymentMethods)[number];

export const offlineSyncStatuses = [
  "PENDING",
  "PROCESSING",
  "FAILED",
  "SYNCED",
  "SYNCED_WITH_CONFLICT",
  "CONFLICT",
  "REJECTED",
] as const;

export type OfflineSyncStatus = (typeof offlineSyncStatuses)[number];

export const offlineOrderStateTransitions: Readonly<
  Record<OfflineOrderState, readonly OfflineOrderState[]>
> = {
  LOCAL_NEW: ["LOCAL_CONFIRMED", "LOCAL_CANCELLED"],
  LOCAL_CONFIRMED: ["LOCAL_PREPARING", "LOCAL_READY", "LOCAL_CANCELLED"],
  LOCAL_PREPARING: ["LOCAL_READY", "LOCAL_CANCELLED"],
  LOCAL_READY: ["LOCAL_COMPLETED", "LOCAL_CANCELLED"],
  LOCAL_COMPLETED: [],
  LOCAL_CANCELLED: [],
};

export function canTransitionOfflineOrder(
  current: OfflineOrderState,
  next: OfflineOrderState,
) {
  return offlineOrderStateTransitions[current].includes(next);
}

export const offlineOrderNoteOptionSchema = z.object({
  noteGroupId: uuid,
  noteOptionId: uuid,
  groupName: shortText.min(1),
  optionName: shortText.min(1),
  priceDelta: z.number().int().min(-100_000_000).max(100_000_000),
  sortOrder: z.number().int().min(0).max(1_000_000),
}).strict();

export const offlineOrderItemSchema = z.object({
  localItemId: uuid,
  productId: uuid,
  name: shortText.min(1),
  baseUnitPrice: money,
  unitPrice: money,
  quantity: z.number().int().min(1).max(100),
  note: noteText,
  noteOptions: z.array(offlineOrderNoteOptionSchema).max(50),
}).strict();

export type OfflineOrderItem = z.infer<typeof offlineOrderItemSchema>;

export const offlineOrderEventSchema = z.object({
  eventId: uuid,
  offlineOrderId: uuid,
  previousState: z.enum(offlineOrderStates).nullable(),
  nextState: z.enum(offlineOrderStates),
  reason: shortText.max(200).nullable(),
  occurredAtDevice: timestamp,
}).strict();

export type OfflineOrderEvent = z.infer<typeof offlineOrderEventSchema>;

export const offlinePaymentSchema = z.object({
  localPaymentId: uuid,
  offlineOrderId: uuid,
  paymentOptionId: uuid.nullable(),
  method: z.enum(offlinePaymentMethods),
  status: z.enum(["PAID_LOCAL", "PENDING_RECONCILIATION"]),
  amount: money,
  cashReceived: money.nullable(),
  changeAmount: money.nullable(),
  methodLabel: shortText.min(1),
  cashShiftId: uuid.nullable(),
  recordedAtDevice: timestamp,
}).strict().superRefine((payment, context) => {
  if (payment.method === "CASH") {
    if (
      payment.status !== "PAID_LOCAL"
      || !payment.cashShiftId
      || payment.cashReceived === null
      || payment.changeAmount === null
      || payment.cashReceived < payment.amount
      || payment.changeAmount !== payment.cashReceived - payment.amount
    ) {
      context.addIssue({
        code: "custom",
        message: "OFFLINE_CASH_PAYMENT_INVALID",
      });
    }
    return;
  }
  if (
    payment.status !== "PENDING_RECONCILIATION"
    || payment.cashReceived !== null
    || payment.changeAmount !== null
    || payment.cashShiftId !== null
  ) {
    context.addIssue({
      code: "custom",
      message: "OFFLINE_MANUAL_PAYMENT_INVALID",
    });
  }
});

export type OfflinePayment = z.infer<typeof offlinePaymentSchema>;

export const offlinePrintJobSchema = z.object({
  printJobId: uuid,
  offlineOrderId: uuid,
  printerId: uuid.nullable(),
  templateVersion: z.string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/),
  status: z.enum(["PENDING", "PRINTING", "SUCCEEDED", "FAILED", "CANCELLED"]),
  attemptCount: z.number().int().min(0).max(100),
  printedAt: timestamp.nullable(),
  deduplicationKey: z.string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/),
}).strict().superRefine((job, context) => {
  if (
    (job.status === "SUCCEEDED" && job.printedAt === null)
    || (job.status !== "SUCCEEDED" && job.printedAt !== null)
  ) {
    context.addIssue({ code: "custom", message: "OFFLINE_PRINT_STATUS_INVALID" });
  }
});

export type OfflinePrintJob = z.infer<typeof offlinePrintJobSchema>;

export const offlineOrderSchema = z.object({
  offlineOrderId: uuid,
  deviceId: uuid,
  organizationId: uuid,
  stallId: uuid,
  localSequence: z.number().int().min(1).max(999_999_999),
  localDisplayNumber: z.string()
    .regex(/^OFF-[A-F0-9]{6}-[0-9]{8}-[0-9]{1,9}$/),
  menuSnapshotVersion: z.number().int().min(1),
  itemsSnapshot: z.array(offlineOrderItemSchema).min(1).max(100),
  subtotal: money,
  discountAmount: z.literal(0),
  total: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentMethod: z.enum(offlinePaymentMethods).nullable(),
  paymentStatus: z.enum(["UNPAID", "PAID_LOCAL", "PENDING_RECONCILIATION"]),
  orderStatus: z.enum(offlineOrderStates),
  customerLabel: shortText.max(50),
  customerContact: z.string().trim().max(80),
  note: noteText,
  createdAtDevice: timestamp,
  updatedAtDevice: timestamp,
  idempotencyKey: uuid,
  syncStatus: z.enum(offlineSyncStatuses),
  retryCount: z.number().int().min(0).max(100),
  lastRetryAt: timestamp.nullable(),
  promotionEpoch: z.string().regex(/^[1-9][0-9]*$/),
  protocolVersion: z.literal(OFFLINE_APP_PROTOCOL_VERSION),
}).strict().superRefine((order, context) => {
  const calculatedSubtotal = order.itemsSnapshot.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  if (
    order.subtotal !== calculatedSubtotal
    || order.total !== order.subtotal - order.discountAmount
  ) {
    context.addIssue({ code: "custom", message: "OFFLINE_ORDER_TOTAL_INVALID" });
  }
  if (
    (order.paymentMethod === null) !== (order.paymentStatus === "UNPAID")
    || (order.paymentMethod === "CASH" && order.paymentStatus !== "PAID_LOCAL")
    || (
      order.paymentMethod !== null
      && order.paymentMethod !== "CASH"
      && order.paymentStatus !== "PENDING_RECONCILIATION"
    )
  ) {
    context.addIssue({ code: "custom", message: "OFFLINE_ORDER_PAYMENT_INVALID" });
  }
  if (order.orderStatus === "LOCAL_COMPLETED" && order.paymentStatus === "UNPAID") {
    context.addIssue({ code: "custom", message: "OFFLINE_UNPAID_ORDER_CANNOT_COMPLETE" });
  }
  if (Date.parse(order.updatedAtDevice) < Date.parse(order.createdAtDevice)) {
    context.addIssue({ code: "custom", message: "OFFLINE_ORDER_TIME_INVALID" });
  }
  const configurationKeys = order.itemsSnapshot.map((item) => JSON.stringify([
    item.productId,
    item.note,
    item.noteOptions.map((option) => option.noteOptionId).sort(),
  ]));
  if (new Set(configurationKeys).size !== configurationKeys.length) {
    context.addIssue({ code: "custom", message: "OFFLINE_ORDER_CONFIGURATION_DUPLICATE" });
  }
});

export type OfflineOrder = z.infer<typeof offlineOrderSchema>;

export const offlineCashEventSchema = z.object({
  cashEventId: uuid,
  deviceId: uuid,
  organizationId: uuid,
  stallId: uuid,
  cashShiftId: uuid,
  eventType: z.enum(["CASH_IN", "CASH_OUT", "PROVISIONAL_CLOSE"]),
  amount: money,
  countedAmount: money.nullable(),
  reason: z.string().trim().min(1).max(200),
  occurredAtDevice: timestamp,
  idempotencyKey: uuid,
  promotionEpoch: z.string().regex(/^[1-9][0-9]*$/),
  protocolVersion: z.literal(OFFLINE_APP_PROTOCOL_VERSION),
}).strict().superRefine((event, context) => {
  if (
    (event.eventType === "PROVISIONAL_CLOSE" && event.countedAmount === null)
    || (event.eventType !== "PROVISIONAL_CLOSE" && event.countedAmount !== null)
    || (event.eventType !== "PROVISIONAL_CLOSE" && event.amount <= 0)
  ) {
    context.addIssue({ code: "custom", message: "OFFLINE_CASH_EVENT_INVALID" });
  }
});

export type OfflineCashEvent = z.infer<typeof offlineCashEventSchema>;

export const offlineOrderSyncRecordSchema = z.object({
  recordType: z.literal("ORDER"),
  queueId: uuid,
  order: offlineOrderSchema,
  events: z.array(offlineOrderEventSchema).min(1).max(20),
  payment: offlinePaymentSchema.nullable(),
  printJobs: z.array(offlinePrintJobSchema).max(10),
}).strict().superRefine((record, context) => {
  if (
    record.events.some((event) => event.offlineOrderId !== record.order.offlineOrderId)
    || (
      record.payment !== null
      && record.payment.offlineOrderId !== record.order.offlineOrderId
    )
    || record.printJobs.some((job) => job.offlineOrderId !== record.order.offlineOrderId)
  ) {
    context.addIssue({ code: "custom", message: "OFFLINE_ORDER_RECORD_SCOPE_INVALID" });
  }
  if ((record.payment === null) !== (record.order.paymentStatus === "UNPAID")) {
    context.addIssue({ code: "custom", message: "OFFLINE_ORDER_RECORD_PAYMENT_INVALID" });
  }
});

export const offlineCashSyncRecordSchema = z.object({
  recordType: z.literal("CASH_EVENT"),
  queueId: uuid,
  event: offlineCashEventSchema,
}).strict();

export type OfflineOrderSyncRecord = z.infer<typeof offlineOrderSyncRecordSchema>;
export type OfflineCashSyncRecord = z.infer<typeof offlineCashSyncRecordSchema>;

export const offlineSyncRecordSchema = z.discriminatedUnion("recordType", [
  offlineOrderSyncRecordSchema,
  offlineCashSyncRecordSchema,
]);

export type OfflineSyncRecord = z.infer<typeof offlineSyncRecordSchema>;

export const offlineSyncRequestSchema = z.object({
  installationId: uuid,
  permitToken: z.string().min(64).max(4_096),
  appProtocolVersion: z.literal(OFFLINE_APP_PROTOCOL_VERSION),
  clientSentAt: timestamp,
  records: z.array(offlineSyncRecordSchema).min(1).max(50),
}).strict();

export type OfflineSyncRequest = z.infer<typeof offlineSyncRequestSchema>;

export const offlineSyncConflictTypes = [
  "MENU_VERSION_EXPIRED",
  "PRICE_CHANGED",
  "PRODUCT_DISABLED",
  "PRODUCT_DELETED",
  "ROLE_CHANGED",
  "DEVICE_REVOKED",
  "INVALID_STATE_TRANSITION",
  "DUPLICATE_ORDER",
  "PAYMENT_RECONCILIATION_REQUIRED",
  "CLOCK_SKEW",
  "BACKEND_EPOCH_CHANGED",
  "CASH_TOTAL_MISMATCH",
  "PRINT_STATUS_UNKNOWN",
  "UNKNOWN_REFERENCE",
  "SHIFT_ALREADY_CLOSED",
  "DUPLICATE_CASH_MOVEMENT",
  "MULTIPLE_OFFLINE_SHIFT",
] as const;

export type OfflineSyncConflictType = (typeof offlineSyncConflictTypes)[number];

export type OfflineSyncReceipt = {
  queueId: string;
  localEntityId: string;
  recordType: "ORDER" | "CASH_EVENT";
  outcome: "ACCEPTED" | "ACCEPTED_WITH_CONFLICT" | "DUPLICATE" | "REJECTED";
  canonicalOrderId: string | null;
  canonicalOrderNumber: string | null;
  serverReceivedAt: string;
  conflicts: Array<{
    conflictId: string;
    type: OfflineSyncConflictType;
    resolutionStatus: string;
  }>;
  errorCode?: string;
};

export type OfflineSyncResponse = {
  receipts: OfflineSyncReceipt[];
  serverTime: string;
  promotionEpoch: string;
};

export const offlineSyncResponseSchema = z.object({
  receipts: z.array(z.object({
    queueId: uuid,
    localEntityId: uuid,
    recordType: z.enum(["ORDER", "CASH_EVENT"]),
    outcome: z.enum(["ACCEPTED", "ACCEPTED_WITH_CONFLICT", "DUPLICATE", "REJECTED"]),
    canonicalOrderId: uuid.nullable(),
    canonicalOrderNumber: z.string().trim().min(1).max(80).nullable(),
    serverReceivedAt: timestamp,
    conflicts: z.array(z.object({
      conflictId: uuid,
      type: z.enum(offlineSyncConflictTypes),
      resolutionStatus: z.string().trim().min(1).max(40),
    }).strict()).max(20),
    errorCode: z.string().trim().regex(/^[A-Z0-9_]{1,120}$/).optional(),
  }).strict()).max(50),
  serverTime: timestamp,
  promotionEpoch: z.string().regex(/^[1-9][0-9]*$/),
}).strict();
