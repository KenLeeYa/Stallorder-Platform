import { beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimit = vi.fn();
const processDeliveryWebhook = vi.fn();

vi.mock("@/lib/rate-limit", () => ({ checkPublicRateLimit: checkRateLimit }));
vi.mock("@/lib/security", () => ({
  hashClientIp: () => "hashed-client-ip",
}));
vi.mock("@/server/delivery-platforms/webhook-service", () => ({
  processDeliveryWebhook,
}));

const connectionId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  processDeliveryWebhook.mockResolvedValue({
    accepted: true,
    duplicate: false,
    eventId: "22222222-2222-4222-8222-222222222222",
    jobId: "33333333-3333-4333-8333-333333333333",
  });
});

describe("/api/webhooks/delivery/[provider]", () => {
  it("rejects unknown providers and malformed connection selectors", async () => {
    const route = await import("./route");
    const response = await route.POST(
      new Request("https://example.test/api/webhooks/delivery/unknown", {
        method: "POST",
        headers: { "x-stallorder-delivery-connection": "not-a-uuid" },
      }),
      { params: Promise.resolve({ provider: "unknown" }) },
    );

    expect(response.status).toBe(400);
    expect(processDeliveryWebhook).not.toHaveBeenCalled();
  });

  it("rate limits by provider, connection and hashed client address", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const route = await import("./route");
    const response = await route.POST(
      new Request("https://example.test/api/webhooks/delivery/mock", {
        method: "POST",
        headers: { "x-stallorder-delivery-connection": connectionId },
      }),
      { params: Promise.resolve({ provider: "mock" }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(processDeliveryWebhook).not.toHaveBeenCalled();
  });

  it("returns only replay-safe acknowledgement metadata", async () => {
    const route = await import("./route");
    const request = new Request("https://example.test/api/webhooks/delivery/mock", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stallorder-delivery-connection": connectionId,
      },
      body: "{}",
    });
    const response = await route.POST(
      request,
      { params: Promise.resolve({ provider: "mock" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({ accepted: true, duplicate: false });
    expect(processDeliveryWebhook).toHaveBeenCalledWith({
      provider: "MOCK",
      connectionId,
      request,
      circuit: "CIRCUIT_B_VERCEL",
    });
  });
});
