import { afterEach, describe, expect, it, vi } from "vitest";

const processDueDeliverySyncJobs = vi.fn();

vi.mock("@/server/delivery-platforms/sync-job-service", () => ({
  processDueDeliverySyncJobs,
}));

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  processDueDeliverySyncJobs.mockReset();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("/api/cron/delivery-jobs", () => {
  it("fails closed without the cron secret", async () => {
    delete process.env.CRON_SECRET;
    const route = await import("./route");
    const response = await route.GET(
      new Request("https://example.test/api/cron/delivery-jobs"),
    );

    expect(response.status).toBe(503);
    expect(processDueDeliverySyncJobs).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer secret", async () => {
    process.env.CRON_SECRET = "correct-cron-secret";
    const route = await import("./route");
    const response = await route.GET(new Request(
      "https://example.test/api/cron/delivery-jobs",
      { headers: { authorization: "Bearer incorrect" } },
    ));

    expect(response.status).toBe(401);
    expect(processDueDeliverySyncJobs).not.toHaveBeenCalled();
  });

  it("returns only safe worker outcomes", async () => {
    process.env.CRON_SECRET = "correct-cron-secret";
    processDueDeliverySyncJobs.mockResolvedValue([
      { jobId: "job-001", status: "SUCCEEDED", retryAt: null },
    ]);
    const route = await import("./route");
    const response = await route.GET(new Request(
      "https://example.test/api/cron/delivery-jobs",
      { headers: { authorization: "Bearer correct-cron-secret" } },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      processed: 1,
      outcomes: [{ jobId: "job-001", status: "SUCCEEDED" }],
    });
    expect(JSON.stringify(body)).not.toContain("correct-cron-secret");
  });
});
