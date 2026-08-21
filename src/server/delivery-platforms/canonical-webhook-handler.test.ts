import { beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimit = vi.fn();
const resolveCanonicalDeliveryWebhook = vi.fn();
const processDeliveryWebhook = vi.fn();

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "hashed-client-ip" }));
vi.mock("./webhook-routing", () => ({ resolveCanonicalDeliveryWebhook }));
vi.mock("./webhook-service", () => ({ processDeliveryWebhook }));

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  resolveCanonicalDeliveryWebhook.mockResolvedValue({
    connectionId: "11111111-1111-4111-8111-111111111111",
    request: new Request("https://example.test/verified", { method: "POST", body: "{}" }),
  });
  processDeliveryWebhook.mockResolvedValue({ accepted: true, duplicate: false });
});

describe("canonical delivery webhook handler", () => {
  it("returns the provider-required empty 200 only after durable processing", async () => {
    const request = new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const { handleCanonicalDeliveryWebhook } = await import("./canonical-webhook-handler");
    const response = await handleCanonicalDeliveryWebhook("UBER_EATS", request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
    expect(processDeliveryWebhook).toHaveBeenCalledWith(expect.objectContaining({
      provider: "UBER_EATS",
      connectionId: "11111111-1111-4111-8111-111111111111",
    }));
  });

  it("rate limits before parsing or resolving a tenant", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const { handleCanonicalDeliveryWebhook } = await import("./canonical-webhook-handler");
    const response = await handleCanonicalDeliveryWebhook(
      "FOODPANDA",
      new Request("https://example.test/webhook", { method: "POST" }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(resolveCanonicalDeliveryWebhook).not.toHaveBeenCalled();
  });
});
