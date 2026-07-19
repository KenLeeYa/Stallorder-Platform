import { describe, expect, it } from "vitest";
import { BillingProviderError, type VerifiedBillingEvent } from "./billing-provider";
import { EcpayBillingProvider } from "./ecpay-billing-provider";
import { ManualBillingProvider } from "./manual-billing-provider";
import { MockBillingProvider } from "./mock-billing-provider";
import { NewebpayBillingProvider } from "./newebpay-billing-provider";
import { assertWebhookEventNotProcessed, validateBillingEventPayment } from "./webhook-validation";

const event: VerifiedBillingEvent = {
  provider: "MOCK",
  providerEventId: "event-1",
  eventType: "PAYMENT_SUCCEEDED",
  providerTransactionId: "transaction-1",
  invoiceId: "invoice-1",
  amount: 699,
  currency: "TWD",
  occurredAt: new Date("2026-07-19T00:00:00.000Z"),
};

describe("disabled billing providers", () => {
  it.each([new EcpayBillingProvider(), new NewebpayBillingProvider()])(
    "$code fails closed without making a provider request",
    async (provider) => {
      await expect(provider.createCheckout({
        organizationId: "organization-1",
        invoiceId: "invoice-1",
        amount: 699,
        currency: "TWD",
      })).rejects.toMatchObject({ code: "BILLING_PROVIDER_NOT_CONFIGURED" });
    },
  );
});

describe("manual billing provider", () => {
  it("creates an internal manual-payment checkout without a redirect", async () => {
    const checkout = await new ManualBillingProvider().createCheckout({
      organizationId: "organization-1",
      invoiceId: "invoice-1",
      amount: 699,
      currency: "TWD",
    });
    expect(checkout).toEqual({
      provider: "MANUAL",
      providerTransactionId: null,
      status: "REQUIRES_MANUAL_PAYMENT",
      redirectUrl: null,
    });
  });
});

describe("future billing webhook validation", () => {
  it("rejects an invalid mock signature", async () => {
    const provider = new MockBillingProvider();
    await expect(provider.verifyWebhook(new Request("https://example.test/webhook", {
      method: "POST",
      body: JSON.stringify(event),
    }))).rejects.toMatchObject({ code: "INVALID_WEBHOOK_SIGNATURE" });
  });

  it("rejects duplicate provider events", () => {
    expect(() => assertWebhookEventNotProcessed(true)).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_WEBHOOK_EVENT" }),
    );
  });

  it("rejects payment amount mismatches", () => {
    expect(() => validateBillingEventPayment(event, { amount: 700, currency: "TWD" })).toThrowError(
      expect.objectContaining({ code: "PAYMENT_AMOUNT_MISMATCH" }),
    );
  });

  it("rejects payment currency mismatches", () => {
    expect(() => validateBillingEventPayment(event, { amount: 699, currency: "USD" })).toThrowError(
      expect.objectContaining({ code: "PAYMENT_CURRENCY_MISMATCH" }),
    );
  });

  it("accepts a signed mock event without external I/O", async () => {
    const provider = new MockBillingProvider();
    const verified = await provider.verifyWebhook(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mock-signature": "valid-test-signature" },
      body: JSON.stringify({ ...event, occurredAt: event.occurredAt.toISOString() }),
    }));
    expect(verified).toMatchObject({ provider: "MOCK", providerEventId: "event-1", amount: 699, currency: "TWD" });
  });

  it("uses typed provider errors without exposing payload details", () => {
    expect(new BillingProviderError("INVALID_WEBHOOK_EVENT").message).toBe("INVALID_WEBHOOK_EVENT");
  });
});
