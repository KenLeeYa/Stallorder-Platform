import { describe, expect, it } from "vitest";
import { MockPaymentProviderAdapter } from "./mock-adapter";
import { assertPaymentMockEnvironment } from "./runtime-policy";
import { assertPaymentTransition } from "./state-machine";

const secret = "test-only-payment-webhook-secret-with-32-characters";
const now = new Date("2026-08-23T09:00:00.000Z");

function create(adapter: MockPaymentProviderAdapter, values: Record<string, unknown> = {}) {
  return adapter.createPaymentSession({
    merchantOrderId: "ORDER-1001",
    amount: 180,
    currency: "TWD",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    returnUrl: "https://preview.example.test/payment/return",
    cancelUrl: "https://preview.example.test/payment/cancel",
    ...values,
  });
}

describe("provider-neutral payment foundation", () => {
  it("allows Mock only in local/test or Vercel Preview and always rejects Production", () => {
    expect(() => assertPaymentMockEnvironment({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertPaymentMockEnvironment({ NODE_ENV: "production", VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertPaymentMockEnvironment({ NODE_ENV: "production", VERCEL_ENV: "production" }))
      .toThrow("PAYMENT_MOCK_FORBIDDEN");
    expect(() => assertPaymentMockEnvironment({ NODE_ENV: "production" }))
      .toThrow("PAYMENT_MOCK_FORBIDDEN");
  });

  it("does not trust a browser return to mark a payment PAID", () => {
    expect(() => assertPaymentTransition(
      "REQUIRES_CUSTOMER_ACTION",
      "PAID",
      "BROWSER_RETURN",
    )).toThrow("PAYMENT_TRUSTED_EVIDENCE_REQUIRED");
  });

  it("creates idempotently and rejects reuse with different money", async () => {
    const adapter = new MockPaymentProviderAdapter("LINE_PAY", secret, () => now);
    const first = await create(adapter);
    const replay = await create(adapter);
    expect(first.status).toBe("REQUIRES_CUSTOMER_ACTION");
    expect(replay).toMatchObject({
      providerTransactionId: first.providerTransactionId,
      idempotentReplay: true,
    });
    await expect(create(adapter, { amount: 181 })).rejects
      .toThrow("PAYMENT_IDEMPOTENCY_CONFLICT");
  });

  it("accepts a signed webhook exactly once even when it arrives before return", async () => {
    const adapter = new MockPaymentProviderAdapter("JKO_PAY", secret, () => now);
    const created = await create(adapter);
    const webhook = adapter.createSignedWebhook({
      providerTransactionId: created.providerTransactionId,
      status: "PAID",
    });
    const first = await adapter.verifyWebhook(webhook);
    const duplicate = await adapter.verifyWebhook(webhook);
    expect(first).toMatchObject({ status: "PAID", duplicate: false });
    expect(duplicate).toMatchObject({ status: "PAID", duplicate: true });
  });

  it("rejects an invalid signature", async () => {
    const adapter = new MockPaymentProviderAdapter("TWQR", secret, () => now);
    const created = await create(adapter);
    const webhook = adapter.createSignedWebhook({
      providerTransactionId: created.providerTransactionId,
      status: "PAID",
    });
    await expect(adapter.verifyWebhook({ ...webhook, signature: `${webhook.signature}0` }))
      .rejects.toThrow("PAYMENT_WEBHOOK_SIGNATURE_INVALID");
  });

  it("supports idempotent partial and full refunds", async () => {
    const adapter = new MockPaymentProviderAdapter("PX_PAY_PLUS", secret, () => now);
    const created = await create(adapter);
    await adapter.completeCustomerAction(created.providerTransactionId);
    const first = await adapter.refundPayment({
      providerTransactionId: created.providerTransactionId,
      amount: 80,
      currency: "TWD",
      reason: "customer request",
      idempotencyKey: "refund-one",
    });
    const replay = await adapter.refundPayment({
      providerTransactionId: created.providerTransactionId,
      amount: 80,
      currency: "TWD",
      reason: "customer request",
      idempotencyKey: "refund-one",
    });
    const full = await adapter.refundPayment({
      providerTransactionId: created.providerTransactionId,
      amount: 100,
      currency: "TWD",
      reason: "customer request",
      idempotencyKey: "refund-two",
    });
    expect(first.status).toBe("PARTIALLY_REFUNDED");
    expect(replay.idempotentReplay).toBe(true);
    expect(full.status).toBe("REFUNDED");
  });

  it("reports reconciliation mismatches without mutating the order", async () => {
    const adapter = new MockPaymentProviderAdapter("TAIWAN_PAY", secret, () => now);
    const created = await create(adapter);
    await adapter.completeCustomerAction(created.providerTransactionId);
    await expect(adapter.reconcile({
      providerTransactionId: created.providerTransactionId,
      expectedAmount: 200,
      expectedCurrency: "TWD",
      expectedStatus: "PAID",
    })).resolves.toEqual({
      providerTransactionId: created.providerTransactionId,
      outcome: "MISMATCH",
      mismatchCodes: ["AMOUNT_MISMATCH"],
      providerStatus: "PAID",
    });
  });
});
