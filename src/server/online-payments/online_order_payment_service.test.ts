import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createIntent: vi.fn(),
  recordEvent: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/online-payments/online-payment-repository", () => ({
  createOnlineOrderPaymentIntentRecord: mocks.createIntent,
  recordOnlineOrderPaymentEvent: mocks.recordEvent,
  reconcileOnlineOrderPaymentRecord: mocks.reconcile,
}));

import {
  createLocalMockPaymentWebhook,
  createOnlineOrderPaymentIntent,
  processOnlineOrderPaymentWebhook,
  reconcileOnlineOrderPayment,
} from "@/server/online-payments/online-payment-service";

const secret = "local-payment-webhook-secret-at-least-32-bytes";
const intent = {
  intentId: "11111111-1111-4111-8111-111111111111",
  providerIntentId: "local_mock_pi_11111111111141118111111111111111",
  orderId: "22222222-2222-4222-8222-222222222222",
  amount: 420,
  currency: "TWD",
};

describe("online order payment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VERCEL_ENV;
    process.env.ONLINE_PAYMENT_LOCAL_MOCK_WEBHOOK_SECRET = secret;
  });

  it("creates a server-derived intent with a non-PII request fingerprint", async () => {
    mocks.createIntent.mockResolvedValue({
      ok: true,
      code: "PAYMENT_INTENT_CREATED",
      ...intent,
      status: "REQUIRES_AUTHORIZATION",
      idempotentReplay: false,
    });

    const result = await createOnlineOrderPaymentIntent({
      organizationId: "33333333-3333-4333-8333-333333333333",
      stallId: "44444444-4444-4444-8444-444444444444",
      orderId: intent.orderId,
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      requestId: "payment-create-1",
    });

    expect(mocks.createIntent).toHaveBeenCalledWith(expect.objectContaining({
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(JSON.stringify(mocks.createIntent.mock.calls[0])).not.toContain("customer");
    expect(result.provider).toBe("LOCAL_MOCK");
  });

  it.each(["AUTHORIZE", "CAPTURE", "FAIL", "TIMEOUT"] as const)(
    "generates a signed, normalized %s local mock event",
    async (operation) => {
      const generated = createLocalMockPaymentWebhook({
        ...intent,
        operation,
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
        occurredAt: "2026-08-13T02:00:00.000Z",
      }, { now: () => new Date("2026-08-13T02:00:30.000Z") });

      expect(generated.signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      expect(generated.rawBody).toContain(`"provider":"LOCAL_MOCK"`);
      expect(generated.rawBody).toContain(`"amount":420`);
      expect(generated.rawBody).not.toContain(secret);
    },
  );

  it("verifies the raw body before recording a webhook and never reconciles inline", async () => {
    const generated = createLocalMockPaymentWebhook({
      ...intent,
      operation: "CAPTURE",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
      occurredAt: "2026-08-13T02:00:00.000Z",
    }, { now: () => new Date("2026-08-13T02:00:30.000Z") });
    mocks.recordEvent.mockResolvedValue({
      ok: true,
      code: "PAYMENT_EVENT_RECORDED",
      eventId: "event-row-1",
      intentId: intent.intentId,
      intentStatus: "CAPTURED",
      processingStatus: "RECORDED",
      duplicate: false,
    });

    await processOnlineOrderPaymentWebhook({
      rawBody: generated.rawBody,
      signature: generated.signature,
      requestId: "webhook-request-1",
    }, { now: () => new Date("2026-08-13T02:00:30.000Z") });

    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      provider: "LOCAL_MOCK",
      bodySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      amount: 420,
      currency: "TWD",
    }));
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("rejects a tampered raw body and stale timestamp before database writes", async () => {
    const generated = createLocalMockPaymentWebhook({
      ...intent,
      operation: "CAPTURE",
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
      occurredAt: "2026-08-13T02:00:00.000Z",
    }, { now: () => new Date("2026-08-13T02:00:30.000Z") });

    await expect(processOnlineOrderPaymentWebhook({
      rawBody: generated.rawBody.replace("420", "421"),
      signature: generated.signature,
      requestId: "tampered",
    }, { now: () => new Date("2026-08-13T02:00:30.000Z") })).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
    });
    await expect(processOnlineOrderPaymentWebhook({
      rawBody: generated.rawBody,
      signature: generated.signature,
      requestId: "stale",
    }, { now: () => new Date("2026-08-13T02:06:00.000Z") })).rejects.toMatchObject({
      code: "PAYMENT_WEBHOOK_TIMESTAMP_EXPIRED",
    });
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("fails closed for every local mock operation in Production", async () => {
    const generated = createLocalMockPaymentWebhook({
      ...intent,
      operation: "AUTHORIZE",
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
      occurredAt: "2026-08-13T02:00:00.000Z",
    }, {
      environment: { NODE_ENV: "test" },
      now: () => new Date("2026-08-13T02:00:30.000Z"),
    });
    process.env.VERCEL_ENV = "production";
    expect(() => createLocalMockPaymentWebhook({
      ...intent,
      operation: "AUTHORIZE",
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
      occurredAt: "2026-08-13T02:00:00.000Z",
    })).toThrowError("PAYMENT_LOCAL_MOCK_DISABLED_IN_PRODUCTION");
    await expect(createOnlineOrderPaymentIntent({
      organizationId: "33333333-3333-4333-8333-333333333333",
      stallId: "44444444-4444-4444-8444-444444444444",
      orderId: intent.orderId,
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      requestId: "production-create",
    })).rejects.toMatchObject({ code: "PAYMENT_LOCAL_MOCK_DISABLED_IN_PRODUCTION" });
    await expect(processOnlineOrderPaymentWebhook({
      rawBody: generated.rawBody,
      signature: generated.signature,
      requestId: "production-webhook",
    })).rejects.toMatchObject({ code: "PAYMENT_LOCAL_MOCK_DISABLED_IN_PRODUCTION" });
    await expect(reconcileOnlineOrderPayment({
      organizationId: "33333333-3333-4333-8333-333333333333",
      stallId: "44444444-4444-4444-8444-444444444444",
      intentId: intent.intentId,
      requestId: "production-reconcile",
    })).rejects.toMatchObject({ code: "PAYMENT_LOCAL_MOCK_DISABLED_IN_PRODUCTION" });
    expect(mocks.createIntent).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("runs reconciliation only through the explicit service operation", async () => {
    mocks.reconcile.mockResolvedValue({
      ok: true,
      code: "PAYMENT_RECONCILED",
      intentId: intent.intentId,
      paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      idempotentReplay: false,
    });

    const result = await reconcileOnlineOrderPayment({
      organizationId: "33333333-3333-4333-8333-333333333333",
      stallId: "44444444-4444-4444-8444-444444444444",
      intentId: intent.intentId,
      requestId: "reconcile-1",
    });

    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(result.code).toBe("PAYMENT_RECONCILED");
  });
});
