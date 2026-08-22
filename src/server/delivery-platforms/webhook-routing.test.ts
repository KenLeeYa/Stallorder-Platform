import { beforeEach, describe, expect, it, vi } from "vitest";

const findConnection = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deliveryPlatformConnection: { findFirst: findConnection },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  findConnection.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
});

describe("canonical delivery webhook routing", () => {
  it("routes Uber only by the active provider/store mapping and preserves raw bytes", async () => {
    const payload = {
      event_type: "orders.notification",
      event_id: "event-1",
      event_time: 1_727_976_000,
      meta: { resource_id: "order-1", user_id: "uber-store-1" },
      resource_href: "https://test-api.uber.com/v2/eats/order/order-1",
    };
    const rawBody = JSON.stringify(payload, null, 2);
    const { resolveCanonicalDeliveryWebhook } = await import("./webhook-routing");
    const result = await resolveCanonicalDeliveryWebhook({
      provider: "UBER_EATS",
      request: new Request("https://example.test/api/integrations/ubereats/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rawBody,
      }),
    });

    expect(findConnection).toHaveBeenCalledWith({
      where: { provider: "UBER_EATS", externalStoreId: "uber-store-1", status: "ACTIVE" },
      select: { id: true },
    });
    expect(result.connectionId).toBe("11111111-1111-4111-8111-111111111111");
    await expect(result.request.text()).resolves.toBe(rawBody);
  });

  it("routes foodpanda by the documented client.store_id", async () => {
    const payload = {
      order_id: "order-1",
      order_type: "DELIVERY",
      client: { store_id: "foodpanda-store-1" },
      items: [{
        _id: "item-1",
        name: "Item",
        pricing: { quantity: 1, total_price: 100, unit_price: 100 },
      }],
      payment: { order_total: 100, sub_total: 100, type: "PAID" },
      status: "RECEIVED",
      sys: { created_at: "2026-08-21T10:00:00.000Z" },
      transport_type: "LOGISTICS_DELIVERY",
    };
    const { resolveCanonicalDeliveryWebhook } = await import("./webhook-routing");
    await resolveCanonicalDeliveryWebhook({
      provider: "FOODPANDA",
      request: new Request("https://example.test/api/integrations/foodpanda/webhooks/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    });
    expect(findConnection).toHaveBeenCalledWith(expect.objectContaining({
      where: { provider: "FOODPANDA", externalStoreId: "foodpanda-store-1", status: "ACTIVE" },
    }));
  });

  it("does not disclose whether an unknown store exists", async () => {
    findConnection.mockResolvedValue(null);
    const { resolveCanonicalDeliveryWebhook } = await import("./webhook-routing");
    await expect(resolveCanonicalDeliveryWebhook({
      provider: "UBER_EATS",
      request: new Request("https://example.test/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event_type: "orders.notification",
          event_id: "event-1",
          event_time: 1,
          meta: { resource_id: "order-1", user_id: "unknown-store" },
          resource_href: "https://test-api.uber.com/v2/eats/order/order-1",
        }),
      }),
    })).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });
  });

  it("cancels an oversized chunked body before reading every chunk", async () => {
    const stream = oversizedStream(40_000, 10);
    const { resolveCanonicalDeliveryWebhook } = await import("./webhook-routing");
    const request = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(resolveCanonicalDeliveryWebhook({
      provider: "UBER_EATS",
      request,
    })).rejects.toMatchObject({ code: "INVALID_WEBHOOK" });
    expect(stream.cancelled()).toBe(true);
    expect(stream.pulls()).toBeLessThan(10);
    expect(findConnection).not.toHaveBeenCalled();
  });
});

function oversizedStream(chunkBytes: number, chunkCount: number) {
  let pullCount = 0;
  let wasCancelled = false;
  return {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount >= chunkCount) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunkBytes).fill(65));
        pullCount += 1;
      },
      cancel() {
        wasCancelled = true;
      },
    }),
    cancelled: () => wasCancelled,
    pulls: () => pullCount,
  };
}
