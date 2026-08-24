import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("@/server/billing/payg-automatic-close-service", () => ({ processAutomaticPaygClose: mocks.process }));

import { GET } from "./route";

const originalSecret = process.env.CRON_SECRET;
afterEach(() => {
  vi.clearAllMocks();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("PAYG automatic close cron", () => {
  it("fails closed without the configured cron credential", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request("http://localhost/api/cron/payg-close"));
    expect(response.status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("runs the shared close executor after cron authentication", async () => {
    process.env.CRON_SECRET = "correct-secret";
    mocks.process.mockResolvedValue({ status: "DISABLED", eligible: 0, succeeded: 0, skipped: 0, failed: 0 });
    const response = await GET(new Request("http://localhost/api/cron/payg-close", { headers: { authorization: "Bearer correct-secret" } }));
    expect(response.status).toBe(200);
    expect(mocks.process).toHaveBeenCalledOnce();
  });
});
