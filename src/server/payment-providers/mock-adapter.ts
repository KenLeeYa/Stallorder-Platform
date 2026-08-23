import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assertPaymentTransition } from "./state-machine";
import {
  assertTwdAmount,
  canonicalPaymentStatuses,
  PaymentProviderError,
  type CancelPaymentInput,
  type CancelPaymentResult,
  type CanonicalPaymentStatus,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProviderAdapter,
  type PaymentProviderCode,
  type QueryPaymentInput,
  type QueryPaymentResult,
  type ReconcileInput,
  type ReconciliationResult,
  type RefundPaymentInput,
  type RefundPaymentResult,
  type VerifiedWebhook,
  type VerifyWebhookInput,
} from "./types";

type StoredTransaction = {
  fingerprint: string;
  providerTransactionId: string;
  merchantOrderId: string;
  amount: number;
  currency: "TWD";
  status: CanonicalPaymentStatus;
  providerStatus: string;
  expiresAt: string;
  refundedAmount: number;
};

const webhookSchema = z.object({
  provider: z.string(),
  eventId: z.string().min(8).max(200),
  providerTransactionId: z.string().min(8).max(200),
  status: z.enum(canonicalPaymentStatuses),
  providerStatus: z.string().min(1).max(120),
  amount: z.number().int().positive(),
  currency: z.literal("TWD"),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeSignatureEqual(actual: string, expected: string) {
  if (!/^[0-9a-f]{64}$/.test(actual)) return false;
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export class MockPaymentProviderAdapter implements PaymentProviderAdapter {
  readonly environment = "MOCK" as const;
  private readonly transactions = new Map<string, StoredTransaction>();
  private readonly idempotency = new Map<string, string>();
  private readonly refunds = new Map<string, RefundPaymentResult>();
  private readonly events = new Set<string>();

  constructor(
    readonly provider: PaymentProviderCode,
    private readonly webhookSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(webhookSecret, "utf8") < 32) {
      throw new PaymentProviderError("PAYMENT_MOCK_SECRET_INVALID", 500);
    }
  }

  async createPaymentSession(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    assertTwdAmount(input.amount, input.currency);
    const fingerprint = sha256(JSON.stringify({
      provider: this.provider,
      merchantOrderId: input.merchantOrderId,
      amount: input.amount,
      currency: input.currency,
    }));
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.transactions.get(existingId)!;
      if (existing.fingerprint !== fingerprint) {
        throw new PaymentProviderError("PAYMENT_IDEMPOTENCY_CONFLICT");
      }
      return this.createResult(existing, true);
    }

    const providerTransactionId = `mock_${this.provider.toLowerCase()}_${sha256(`${input.idempotencyKey}:${input.merchantOrderId}`).slice(0, 24)}`;
    const scenario = input.mockScenario ?? "SUCCESS";
    const status: CanonicalPaymentStatus = scenario === "FAILED"
      ? "FAILED"
      : scenario === "EXPIRED"
        ? "EXPIRED"
        : "REQUIRES_CUSTOMER_ACTION";
    const transaction: StoredTransaction = {
      fingerprint,
      providerTransactionId,
      merchantOrderId: input.merchantOrderId,
      amount: input.amount,
      currency: input.currency,
      status,
      providerStatus: scenario === "PENDING" ? "MOCK_PENDING" : `MOCK_${scenario}`,
      expiresAt: new Date(this.now().getTime() + 15 * 60_000).toISOString(),
      refundedAmount: 0,
    };
    this.transactions.set(providerTransactionId, transaction);
    this.idempotency.set(input.idempotencyKey, providerTransactionId);
    return this.createResult(transaction, false);
  }

  completeCustomerAction(
    providerTransactionId: string,
    outcome: "SUCCESS" | "PENDING" | "FAILED" | "EXPIRED" = "SUCCESS",
  ) {
    const transaction = this.requireTransaction(providerTransactionId);
    const next: CanonicalPaymentStatus = outcome === "SUCCESS"
      ? "PAID"
      : outcome === "PENDING"
        ? "PENDING"
        : outcome;
    assertPaymentTransition(transaction.status, next, "VERIFIED_PROVIDER_CONFIRMATION");
    transaction.status = next;
    transaction.providerStatus = `MOCK_${outcome}`;
    return this.queryPayment({ providerTransactionId });
  }

  async queryPayment(input: QueryPaymentInput): Promise<QueryPaymentResult> {
    const transaction = this.requireTransaction(input.providerTransactionId);
    return {
      providerTransactionId: transaction.providerTransactionId,
      status: transaction.status,
      providerStatus: transaction.providerStatus,
      expiresAt: transaction.expiresAt,
    };
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentResult> {
    const transaction = this.requireTransaction(input.providerTransactionId);
    const replay = transaction.status === "CANCELLED";
    if (!replay) {
      assertPaymentTransition(transaction.status, "CANCELLED", "VERIFIED_PROVIDER_QUERY");
      transaction.status = "CANCELLED";
      transaction.providerStatus = "MOCK_CANCELLED";
    }
    return { ...(await this.queryPayment(input)), idempotentReplay: replay };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    assertTwdAmount(input.amount, input.currency);
    const previous = this.refunds.get(input.idempotencyKey);
    if (previous) return { ...previous, idempotentReplay: true };
    const transaction = this.requireTransaction(input.providerTransactionId);
    if (transaction.status !== "PAID" && transaction.status !== "PARTIALLY_REFUNDED") {
      throw new PaymentProviderError("PAYMENT_REFUND_STATUS_INVALID");
    }
    if (transaction.refundedAmount + input.amount > transaction.amount) {
      throw new PaymentProviderError("PAYMENT_REFUND_AMOUNT_EXCEEDS_PAID", 400);
    }
    transaction.refundedAmount += input.amount;
    const status = transaction.refundedAmount === transaction.amount
      ? "REFUNDED" as const
      : "PARTIALLY_REFUNDED" as const;
    assertPaymentTransition(transaction.status, status, "VERIFIED_PROVIDER_CONFIRMATION");
    transaction.status = status;
    transaction.providerStatus = `MOCK_${status}`;
    const result: RefundPaymentResult = {
      providerRefundId: `mock_ref_${sha256(input.idempotencyKey).slice(0, 24)}`,
      providerTransactionId: transaction.providerTransactionId,
      refundedAmount: input.amount,
      status,
      providerStatus: transaction.providerStatus,
      idempotentReplay: false,
    };
    this.refunds.set(input.idempotencyKey, result);
    return result;
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook> {
    const timestamp = Math.floor(input.receivedAt.getTime() / 1_000);
    const components = Object.fromEntries(input.signature.split(",").map((part) => part.trim().split("=", 2)));
    if (!/^\d+$/.test(components.t ?? "") || Math.abs(timestamp - Number(components.t)) > 300) {
      throw new PaymentProviderError("PAYMENT_WEBHOOK_TIMESTAMP_INVALID", 400);
    }
    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${components.t}.${input.rawBody}`, "utf8")
      .digest("hex");
    if (!safeSignatureEqual(components.v1 ?? "", expected)) {
      throw new PaymentProviderError("PAYMENT_WEBHOOK_SIGNATURE_INVALID", 400);
    }
    const event = webhookSchema.parse(JSON.parse(input.rawBody));
    if (event.provider !== this.provider) {
      throw new PaymentProviderError("PAYMENT_WEBHOOK_PROVIDER_MISMATCH", 400);
    }
    const transaction = this.requireTransaction(event.providerTransactionId);
    if (transaction.amount !== event.amount || transaction.currency !== event.currency) {
      throw new PaymentProviderError("PAYMENT_WEBHOOK_AMOUNT_MISMATCH", 409);
    }
    const duplicate = this.events.has(event.eventId);
    if (!duplicate) {
      assertPaymentTransition(transaction.status, event.status, "SIGNED_WEBHOOK");
      transaction.status = event.status;
      transaction.providerStatus = event.providerStatus;
      this.events.add(event.eventId);
    }
    return {
      ...event,
      provider: this.provider,
      externalEventId: event.eventId,
      bodyHash: sha256(input.rawBody),
      duplicate,
    };
  }

  async reconcile(input: ReconcileInput): Promise<ReconciliationResult> {
    assertTwdAmount(input.expectedAmount, input.expectedCurrency);
    const transaction = this.requireTransaction(input.providerTransactionId);
    const mismatchCodes = [
      transaction.amount !== input.expectedAmount ? "AMOUNT_MISMATCH" : null,
      transaction.currency !== input.expectedCurrency ? "CURRENCY_MISMATCH" : null,
      transaction.status !== input.expectedStatus ? "STATUS_MISMATCH" : null,
    ].filter((code): code is string => Boolean(code));
    return {
      providerTransactionId: transaction.providerTransactionId,
      outcome: mismatchCodes.length ? "MISMATCH" : "MATCHED",
      mismatchCodes,
      providerStatus: transaction.status,
    };
  }

  createSignedWebhook(input: {
    providerTransactionId: string;
    status: CanonicalPaymentStatus;
    eventId?: string;
    occurredAt?: Date;
  }) {
    const transaction = this.requireTransaction(input.providerTransactionId);
    const occurredAt = input.occurredAt ?? this.now();
    const payload = JSON.stringify({
      provider: this.provider,
      eventId: input.eventId ?? `mock_evt_${sha256(`${transaction.providerTransactionId}:${input.status}`).slice(0, 24)}`,
      providerTransactionId: transaction.providerTransactionId,
      status: input.status,
      providerStatus: `MOCK_${input.status}`,
      amount: transaction.amount,
      currency: transaction.currency,
      occurredAt: occurredAt.toISOString(),
    });
    const timestamp = Math.floor(occurredAt.getTime() / 1_000);
    const signature = createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.${payload}`, "utf8")
      .digest("hex");
    return { rawBody: payload, signature: `t=${timestamp},v1=${signature}`, receivedAt: occurredAt };
  }

  private requireTransaction(providerTransactionId: string) {
    const transaction = this.transactions.get(providerTransactionId);
    if (!transaction) throw new PaymentProviderError("PAYMENT_TRANSACTION_NOT_FOUND", 404);
    return transaction;
  }

  private createResult(transaction: StoredTransaction, idempotentReplay: boolean): CreatePaymentResult {
    return {
      providerTransactionId: transaction.providerTransactionId,
      status: transaction.status,
      providerStatus: transaction.providerStatus,
      customerActionUrl: transaction.status === "REQUIRES_CUSTOMER_ACTION"
        ? `https://mock.invalid/pay/${transaction.providerTransactionId}`
        : null,
      expiresAt: transaction.expiresAt,
      idempotentReplay,
    };
  }
}
