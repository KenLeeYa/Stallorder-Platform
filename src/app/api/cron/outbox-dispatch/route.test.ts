import { afterEach, describe, expect, it, vi } from "vitest";

const processOutboxDispatchCycle = vi.fn();

vi.mock("@/server/outbox/outbox-dispatcher", () => ({
  processOutboxDispatchCycle,
}));

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  processOutboxDispatchCycle.mockReset();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("/api/cron/outbox-dispatch", () => {
  it("fails closed without the cron secret", async () => {
    delete process.env.CRON_SECRET;
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/cron/outbox-dispatch"));

    expect(response.status).toBe(503);
    expect(processOutboxDispatchCycle).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer secret", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/cron/outbox-dispatch", {
      headers: { authorization: "Bearer wrong-secret" },
    }));

    expect(response.status).toBe(401);
    expect(processOutboxDispatchCycle).not.toHaveBeenCalled();
  });

  it("returns aggregate outcomes without payloads or secrets", async () => {
    process.env.CRON_SECRET = "correct-secret";
    processOutboxDispatchCycle.mockResolvedValue({
      outcomes: [{ outboxId: "outbox-1", status: "DELIVERED" }],
      domainQuarantined: 2,
      health: { pendingDepth: 3, oldestPendingAgeSeconds: 45, deadLetterDepth: 1 },
      alerts: ["NOTIFICATION_OUTBOX_DEAD_LETTER_PRESENT"],
    });
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/cron/outbox-dispatch", {
      headers: {
        authorization: "Bearer correct-secret",
        "x-provider-secret": "must-not-leak",
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      processed: 1,
      outcomes: [{ outboxId: "outbox-1", status: "DELIVERED" }],
      domainQuarantined: 2,
      health: { pendingDepth: 3, oldestPendingAgeSeconds: 45, deadLetterDepth: 1 },
      alerts: ["NOTIFICATION_OUTBOX_DEAD_LETTER_PRESENT"],
    });
    expect(JSON.stringify(body)).not.toContain("correct-secret");
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });
});
