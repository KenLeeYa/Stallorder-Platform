import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type OnlinePaymentFailure = { ok: false; code: string; matchCode?: string };

export type OnlinePaymentIntentResult = OnlinePaymentFailure | {
  ok: true;
  code: "PAYMENT_INTENT_CREATED" | "PAYMENT_INTENT_IDEMPOTENT_REPLAY";
  intentId: string;
  providerIntentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  idempotentReplay: boolean;
};

export type OnlinePaymentEventResult = OnlinePaymentFailure | {
  ok: true;
  code: "PAYMENT_EVENT_RECORDED" | "PAYMENT_EVENT_DUPLICATE";
  eventId: string;
  intentId: string;
  intentStatus?: string;
  processingStatus: string;
  duplicate: boolean;
};

export type OnlinePaymentReconciliationResult = OnlinePaymentFailure | {
  ok: true;
  code: "PAYMENT_RECONCILED" | "PAYMENT_RECONCILIATION_IDEMPOTENT_REPLAY";
  intentId: string;
  paymentId: string;
  idempotentReplay: boolean;
};

async function jsonResult<T>(query: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Array<{ result: T | null }>>(query);
  return rows[0]?.result ?? null;
}

export function createOnlineOrderPaymentIntentRecord(input: {
  organizationId: string;
  stallId: string;
  orderId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  requestId: string;
}) {
  return jsonResult<OnlinePaymentIntentResult>(Prisma.sql`
    select app_private.create_online_order_payment_intent(
      ${input.organizationId}::uuid,
      ${input.stallId}::uuid,
      ${input.orderId}::uuid,
      ${input.idempotencyKey}::text,
      ${input.requestFingerprint}::text,
      ${input.requestId}::text
    ) as result
  `);
}

export function recordOnlineOrderPaymentEvent(input: {
  provider: "LOCAL_MOCK";
  providerEventId: string;
  providerIntentId: string;
  eventType: string;
  providerCreatedAt: Date;
  signatureTimestamp: Date;
  bodySha256: string;
  orderReference: string;
  amount: number;
  currency: string;
  requestId: string;
}) {
  return jsonResult<OnlinePaymentEventResult>(Prisma.sql`
    select app_private.record_online_order_payment_event(
      ${input.provider}::text,
      ${input.providerEventId}::text,
      ${input.providerIntentId}::text,
      ${input.eventType}::text,
      ${input.providerCreatedAt}::timestamptz,
      ${input.signatureTimestamp}::timestamptz,
      ${input.bodySha256}::text,
      ${input.orderReference}::text,
      ${input.amount}::integer,
      ${input.currency}::text,
      ${input.requestId}::text
    ) as result
  `);
}

export function reconcileOnlineOrderPaymentRecord(input: {
  organizationId: string;
  stallId: string;
  intentId: string;
  requestId: string;
}) {
  return jsonResult<OnlinePaymentReconciliationResult>(Prisma.sql`
    select app_private.reconcile_online_order_payment(
      ${input.organizationId}::uuid,
      ${input.stallId}::uuid,
      ${input.intentId}::uuid,
      ${input.requestId}::text
    ) as result
  `);
}
