import { describe, expect, it, vi } from "vitest";
import { FoodpandaApiClient } from "./foodpanda-client";

const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  stallId: "33333333-3333-4333-8333-333333333333",
  provider: "FOODPANDA" as const,
  externalChainId: "chain/with-slash",
  externalStoreId: "vendor-1",
  credentialReference: "vercel://FOODPANDA_CLIENT_SECRET",
};

const order = {
  accepted_for: null,
  promised_for: "2026-08-21T10:30:00.000Z",
  comment: null,
  external_order_id: "external-1",
  order_code: "FP001",
  order_id: "order-1",
  order_type: "DELIVERY",
  client: { store_id: "vendor-1" },
  items: [{
    _id: "item-1",
    sku: "sku-1",
    name: "Item",
    pricing: { quantity: 1, total_price: 120, unit_price: 120 },
  }],
  payment: { order_total: 120, sub_total: 120, type: "PAID" },
  status: "RECEIVED",
  sys: { created_at: "2026-08-21T10:00:00.000Z" },
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

describe("FoodpandaApiClient", () => {
  it("uses the fixed sandbox origin, encoded IDs and a reused client-credentials token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/oauth/token") {
        return new Response(JSON.stringify({
          access_token: "foodpanda-token",
          token_type: "Bearer",
          expires_in: 7_200,
        }));
      }
      expect(init?.headers).toMatchObject({ authorization: "Bearer foodpanda-token" });
      return new Response(JSON.stringify(order));
    });
    const client = new FoodpandaApiClient({
      environment,
      resolveSecret: () => "foodpanda-secret",
      fetchImpl,
      now: () => Date.parse("2026-08-21T10:10:00.000Z"),
    });

    await expect(client.fetchOrderDetails(connection, "order/1"))
      .resolves.toMatchObject({ externalOrderId: "order-1" });
    await expect(client.fetchOrderDetails(connection, "order/1"))
      .resolves.toMatchObject({ externalOrderId: "order-1" });

    const urls = fetchImpl.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.endsWith("/v2/oauth/token"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("/orders/order%2F1"))).toHaveLength(2);
    expect(urls.every((url) => url.startsWith("https://sandbox.partner.deliveryhero.io/"))).toBe(true);
  });

  it("sends only the documented catalog availability update shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "foodpanda-token",
        token_type: "Bearer",
        expires_in: 7_200,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "job-1" }), { status: 202 }));
    const client = new FoodpandaApiClient({
      environment,
      resolveSecret: () => "foodpanda-secret",
      fetchImpl,
    });

    await client.updateProductAvailability(connection, "sku-1", false);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ products: [{ sku: "sku-1", active: false }] }),
    });
  });
});
