import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyUberEatsWebhook } from "./uber-eats-webhook";

const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  stallId: "33333333-3333-4333-8333-333333333333",
  provider: "UBER_EATS" as const,
  externalChainId: null,
  externalStoreId: "89dd9741-66b5-4bb4-b216-a813f3b21b4f",
  credentialReference: "vercel://UBER_EATS_CLIENT_SECRET",
};

const payload = {
  event_type: "orders.notification",
  event_id: "c4d2261e-2779-4eb6-beb0-cb41235c751e",
  event_time: 1_727_976_000,
  meta: {
    resource_id: "153dd7f1-339d-4619-940c-418943c14636",
    status: "pos",
    user_id: "89dd9741-66b5-4bb4-b216-a813f3b21b4f",
  },
  resource_href: "https://test-api.uber.com/v2/eats/order/153dd7f1-339d-4619-940c-418943c14636",
};

const environment = {
  NODE_ENV: "test" as const,
  UBER_EATS_ENVIRONMENT: "sandbox",
  UBER_EATS_CLIENT_ID: "client-1",
  UBER_EATS_CALLBACK_URL: "http://localhost:3000/integrations/ubereats/oauth/callback",
  UBER_EATS_CREDENTIAL_REFERENCE: "vercel://UBER_EATS_CLIENT_SECRET",
  UBER_EATS_WEBHOOK_SECRET_REFERENCE: "vercel://UBER_EATS_WEBHOOK_SECRET",
};

describe("Uber Eats webhook verifier", () => {
  it("verifies raw-body HMAC and returns a fetch reference instead of a guessed order", async () => {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", "uber-webhook-secret").update(body).digest("hex");
    const verified = await verifyUberEatsWebhook(new Request("https://example.test/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-environment": "sandbox",
        "x-uber-signature": signature,
      },
      body,
    }), connection, {
      environment,
      resolveSecret: () => "uber-webhook-secret",
    });

    expect(verified).toMatchObject({
      provider: "UBER_EATS",
      externalEventId: payload.event_id,
      eventType: "orders.notification",
      order: null,
      orderReference: {
        externalOrderId: payload.meta.resource_id,
        externalStoreId: payload.meta.user_id,
      },
    });
  });

  it("rejects changed bodies, wrong environment and off-origin resource URLs", async () => {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", "uber-webhook-secret").update(body).digest("hex");
    const attempt = (overrides: { body?: string; environmentHeader?: string; payload?: unknown }) => {
      const requestBody = overrides.body ?? JSON.stringify(overrides.payload ?? payload);
      return verifyUberEatsWebhook(new Request("https://example.test/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-environment": overrides.environmentHeader ?? "sandbox",
          "x-uber-signature": signature,
        },
        body: requestBody,
      }), connection, { environment, resolveSecret: () => "uber-webhook-secret" });
    };

    await expect(attempt({ body: `${body} ` })).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });
    await expect(attempt({ environmentHeader: "production" })).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });
    const offOrigin = { ...payload, resource_href: `https://attacker.test/v2/eats/order/${payload.meta.resource_id}` };
    const offOriginBody = JSON.stringify(offOrigin);
    const offOriginSignature = createHmac("sha256", "uber-webhook-secret").update(offOriginBody).digest("hex");
    await expect(verifyUberEatsWebhook(new Request("https://example.test/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-environment": "sandbox",
        "x-uber-signature": offOriginSignature,
      },
      body: offOriginBody,
    }), connection, { environment, resolveSecret: () => "uber-webhook-secret" }))
      .rejects.toMatchObject({ code: "INVALID_WEBHOOK" });
  });
});
