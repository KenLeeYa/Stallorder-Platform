import { describe, expect, it } from "vitest";
import { verifyFoodpandaWebhook } from "./foodpanda-webhook";

const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  stallId: "33333333-3333-4333-8333-333333333333",
  provider: "FOODPANDA" as const,
  externalChainId: "chain-1",
  externalStoreId: "vendor-1",
  credentialReference: "vercel://FOODPANDA_CLIENT_SECRET",
};

const payload = {
  accepted_for: null,
  promised_for: "2026-08-21T10:30:00.000Z",
  comment: null,
  external_order_id: "order-78107",
  isPreorder: false,
  order_code: "wxfr-2440-rtbs",
  order_id: "9d4a63b5-3e07-4440-96af-aa04797da3a0",
  order_type: "DELIVERY",
  client: { chain_id: "chain-1", store_id: "vendor-1" },
  customer: null,
  items: [{
    _id: "item-1",
    sku: "sku-1",
    name: "測試餐點",
    pricing: { pricing_type: "UNIT", quantity: 1, total_price: 120, unit_price: 120 },
  }],
  payment: { order_total: 120, sub_total: 120, type: "PAID" },
  status: "RECEIVED",
  sys: { created_at: "2026-08-21T10:00:36.947Z", updated_at: "2026-08-21T10:05:36.947Z" },
  transport_type: "LOGISTICS_DELIVERY",
};

const environment = {
  NODE_ENV: "test" as const,
  FOODPANDA_ENVIRONMENT: "sandbox",
  FOODPANDA_CLIENT_ID: "client-1",
  FOODPANDA_CREDENTIAL_REFERENCE: "vercel://FOODPANDA_CLIENT_SECRET",
  FOODPANDA_WEBHOOK_CREDENTIAL_REFERENCE: "vercel://FOODPANDA_WEBHOOK_AUTHORIZATION",
  FOODPANDA_CURRENCY: "TWD",
};

describe("foodpanda webhook verifier", () => {
  it("authenticates the documented static Authorization token before normalizing", async () => {
    const body = JSON.stringify(payload);
    const verified = await verifyFoodpandaWebhook(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Basic test-value" },
      body,
    }), connection, {
      environment,
      resolveSecret: (reference) => reference.endsWith("WEBHOOK_AUTHORIZATION")
        ? "Basic test-value"
        : "client-secret",
    });

    expect(verified).toMatchObject({
      provider: "FOODPANDA",
      eventType: "RECEIVED",
      signatureValid: true,
      order: {
        externalOrderId: payload.order_id,
        externalStoreId: "vendor-1",
      },
      orderReference: null,
    });
    expect(verified.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verified.replayKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(["", "Basic wrong-value"])("rejects an invalid Authorization value", async (authorization) => {
    await expect(verifyFoodpandaWebhook(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify(payload),
    }), connection, {
      environment,
      resolveSecret: () => "Basic test-value",
    })).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });
  });
});
