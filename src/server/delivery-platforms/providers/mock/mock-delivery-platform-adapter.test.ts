import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import { getDeliveryPlatformAdapter } from "../../delivery-platform-registry";
import { MockDeliveryPlatformAdapter } from "./mock-delivery-platform-adapter";

const secret = "mock-webhook-secret-that-is-longer-than-thirty-two-characters";
const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  stallId: "33333333-3333-4333-8333-333333333333",
  provider: "MOCK" as const,
  externalChainId: "mock-chain-001",
  externalStoreId: "mock-store-taipei-001",
  credentialReference: null,
};
const fixture = {
  eventId: "event-001",
  eventType: "ORDER_CREATED",
  order: {
    externalOrderId: "order-001",
    externalOrderNumber: "M001",
    externalStoreId: "mock-store-taipei-001",
    currency: "TWD",
    placedAt: "2026-07-30T00:00:00.000Z",
    scheduledPickupAt: null,
    customerDisplayName: "合成顧客",
    customerPhoneMasked: "***-***-001",
    customerNote: null,
    items: [{
      externalItemId: "item-001",
      externalProductId: "product-001",
      name: "合成餐點",
      quantity: 1,
      unitPrice: 100,
      totalPrice: 100,
      modifiers: [],
      notes: null,
    }],
    pricing: {
      subtotal: 100,
      platformDiscount: 0,
      merchantDiscount: 0,
      deliveryFee: 20,
      serviceFee: 0,
      tax: 0,
      total: 120,
      merchantReceivable: 100,
    },
    payment: { status: "PAID_BY_PLATFORM", merchantCollectedCash: false },
    fulfillment: { type: "DELIVERY" },
    providerMetadata: { synthetic: true },
  },
};

function webhookRequest(signature: string) {
  const body = JSON.stringify(fixture);
  return new Request("https://preview.example.test/api/webhooks/delivery/mock", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      "x-stallorder-mock-signature": signature,
    },
    body,
  });
}

describe("Mock delivery adapter", () => {
  it("verifies HMAC before returning a normalized synthetic order", async () => {
    const body = JSON.stringify(fixture);
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const adapter = new MockDeliveryPlatformAdapter(secret);

    const result = await adapter.verifyWebhook(webhookRequest(signature), connection);

    expect(result.signatureValid).toBe(true);
    expect(result.order?.provider).toBe("MOCK");
    expect(result.order?.placedAt).toEqual(new Date(fixture.order.placedAt));
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects invalid signatures and deterministic action failures", async () => {
    const adapter = new MockDeliveryPlatformAdapter(secret);
    await expect(
      adapter.verifyWebhook(webhookRequest("0".repeat(64)), connection),
    ).rejects.toMatchObject({ code: "INVALID_WEBHOOK", retryable: false });

    await expect(adapter.acceptOrder({
      connection,
      externalOrderId: "order-001",
      idempotencyKey: "retryable-error-order-001",
    })).rejects.toMatchObject({ code: "RETRYABLE_PROVIDER_ERROR", retryable: true });
  });

  it("cannot be resolved in production", () => {
    expect(() => getDeliveryPlatformAdapter("MOCK", {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      DELIVERY_MOCK_WEBHOOK_SECRET: secret,
    })).toThrowError(DeliveryPlatformError);
  });

  it("is available only for an explicitly marked Vercel Preview", () => {
    expect(getDeliveryPlatformAdapter("MOCK", {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      DELIVERY_MOCK_WEBHOOK_SECRET: secret,
    })).toBeInstanceOf(MockDeliveryPlatformAdapter);
  });
});
