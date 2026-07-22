import { afterEach, describe, expect, it, vi } from "vitest";

const processDueNotificationJobs = vi.fn();

vi.mock("@/server/notifications/notification-job-processor", () => ({
  processDueNotificationJobs,
}));

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  processDueNotificationJobs.mockReset();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("/api/cron/notification-jobs", () => {
  it("fails closed when the cron secret is missing", async () => {
    delete process.env.CRON_SECRET;
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/cron/notification-jobs"));
    expect(response.status).toBe(503);
    expect(processDueNotificationJobs).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer credential", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/cron/notification-jobs", {
      headers: { authorization: "Bearer wrong-secret" },
    }));
    expect(response.status).toBe(401);
    expect(processDueNotificationJobs).not.toHaveBeenCalled();
  });

  it("processes due jobs without reflecting secrets", async () => {
    process.env.CRON_SECRET = "correct-secret";
    processDueNotificationJobs.mockResolvedValue([{ jobId: "job-1", status: "SENT" }]);
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/cron/notification-jobs", {
      headers: {
        authorization: "Bearer correct-secret",
        "x-vercel-protection-bypass": "bypass-secret",
      },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ processed: 1, results: [{ jobId: "job-1", status: "SENT" }] });
    expect(JSON.stringify(body)).not.toContain("correct-secret");
    expect(JSON.stringify(body)).not.toContain("bypass-secret");
  });
});
