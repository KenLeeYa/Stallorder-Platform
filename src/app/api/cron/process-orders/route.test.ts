import { afterEach, describe, expect, it, vi } from "vitest";

const processOrdersCron = vi.fn();

vi.mock("@/lib/order-cron", () => ({
  processOrdersCron,
}));

const originalSecret = process.env.CRON_API_SECRET;

afterEach(() => {
  processOrdersCron.mockReset();
  if (originalSecret === undefined) delete process.env.CRON_API_SECRET;
  else process.env.CRON_API_SECRET = originalSecret;
});

describe("/api/cron/process-orders", () => {
  it("rejects non-POST requests", async () => {
    const route = await import("./route");
    const response = await route.GET();
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: "METHOD_NOT_ALLOWED" });
  });

  it("fails closed when CRON_API_SECRET is missing", async () => {
    delete process.env.CRON_API_SECRET;
    const route = await import("./route");
    const response = await route.POST(new Request("https://example.test/api/cron/process-orders", { method: "POST" }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: "CRON_NOT_CONFIGURED" });
    expect(processOrdersCron).not.toHaveBeenCalled();
  });

  it("rejects invalid bearer credentials", async () => {
    process.env.CRON_API_SECRET = "correct-secret";
    const route = await import("./route");
    const response = await route.POST(new Request("https://example.test/api/cron/process-orders", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: "UNAUTHORIZED" });
    expect(processOrdersCron).not.toHaveBeenCalled();
  });

  it("processes orders with the correct bearer credential", async () => {
    process.env.CRON_API_SECRET = "correct-secret";
    processOrdersCron.mockResolvedValue({ expiredUnconfirmedOrders: 2 });
    const route = await import("./route");
    const response = await route.POST(new Request("https://example.test/api/cron/process-orders", {
      method: "POST",
      headers: {
        authorization: "Bearer correct-secret",
        "x-vercel-protection-bypass": "bypass-secret",
      },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      result: { expiredUnconfirmedOrders: 2 },
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(body.executedAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("correct-secret");
    expect(JSON.stringify(body)).not.toContain("bypass-secret");
    expect(processOrdersCron).toHaveBeenCalledOnce();
  });
});
