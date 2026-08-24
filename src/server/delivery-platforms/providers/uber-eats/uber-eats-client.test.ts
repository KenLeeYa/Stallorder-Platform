import { describe, expect, it, vi } from "vitest";
import { UberEatsApiClient } from "./uber-eats-client";

const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  stallId: "33333333-3333-4333-8333-333333333333",
  provider: "UBER_EATS" as const,
  externalChainId: null,
  externalStoreId: "store-1",
  credentialReference: "vercel://UBER_EATS_CLIENT_SECRET",
};

const environment = {
  NODE_ENV: "test" as const,
  UBER_EATS_ENVIRONMENT: "sandbox",
  UBER_EATS_CLIENT_ID: "client-1",
  UBER_EATS_CALLBACK_URL: "http://localhost:3000/integrations/ubereats/oauth/callback",
  UBER_EATS_CREDENTIAL_REFERENCE: "vercel://UBER_EATS_CLIENT_SECRET",
  UBER_EATS_WEBHOOK_SECRET_REFERENCE: "vercel://UBER_EATS_WEBHOOK_SECRET",
};

describe("UberEatsApiClient", () => {
  it("uses the documented app token scope and accept endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "uber-token",
        token_type: "Bearer",
        expires_in: 2_592_000,
      })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new UberEatsApiClient({
      environment,
      resolveSecret: () => "uber-client-secret",
      fetchImpl,
    });

    await client.acceptOrder(connection, "order/1");

    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://sandbox-login.uber.com/oauth/v2/token");
    expect(String(fetchImpl.mock.calls[0][1]?.body)).toContain("scope=eats.order");
    expect(String(fetchImpl.mock.calls[1][0]))
      .toBe("https://test-api.uber.com/v1/eats/orders/order%2F1/accept_pos_order");
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer uber-token" }),
    });
  });

  it("maps unapproved internal denial reasons to Uber's documented OTHER code", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "uber-token",
        token_type: "Bearer",
        expires_in: 2_592_000,
      })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new UberEatsApiClient({
      environment,
      resolveSecret: () => "uber-client-secret",
      fetchImpl,
    });

    await client.denyOrder(connection, "order-1", "MERCHANT_REJECTED");
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({
      reason: {
        explanation: "Merchant rejected in StallOrder",
        code: "OTHER",
      },
    });
  });

  it("uses sparse suspension updates for item availability", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "uber-token",
        token_type: "Bearer",
        expires_in: 2_592_000,
      })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new UberEatsApiClient({
      environment,
      resolveSecret: () => "uber-client-secret",
      fetchImpl,
      now: () => 1_727_976_000_000,
    });

    await client.updateProductAvailability(connection, "item-1", false);
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({
      suspension_info: {
        suspension: {
          suspend_until: 1_759_512_000,
          reason: "StallOrder availability sync",
        },
      },
    });
  });
});
