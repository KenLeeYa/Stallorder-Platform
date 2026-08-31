import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/server/resilience/dr-operator-readiness", () => ({
  getDrOperatorReadiness: mocks.getReadiness,
}));

describe("/api/health/dr/operator", () => {
  afterEach(() => {
    delete process.env.DR_OPERATOR_PROBE_ENABLED;
    vi.clearAllMocks();
  });

  it("is absent outside the dedicated DR runtime", async () => {
    const route = await import("./route");
    const response = await route.GET();

    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(mocks.getReadiness).not.toHaveBeenCalled();
  });

  it("returns a no-store readiness contract for a valid DR standby", async () => {
    process.env.DR_OPERATOR_PROBE_ENABLED = "true";
    mocks.getReadiness.mockResolvedValue({
      status: "READY",
      checkedAt: "2026-09-01T00:00:00.000Z",
      runtime: {
        backendTarget: "DR",
        authProjectCode: "DR",
        promotionEpoch: 4,
        supabaseProjectRef: "abcdefghijklmnopqrst",
      },
      database: {
        backendCode: "DR",
        backendRole: "READ_ONLY_STANDBY",
        promotionEpoch: 4,
        writesEnabled: false,
        enforcementEnabled: true,
      },
      checks: {
        drRuntimeBinding: true,
        supabaseProjectBinding: true,
        epochAligned: true,
        readOnlyStandby: true,
        writerFence: true,
      },
    });
    const route = await import("./route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.status).toBe("READY");
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|secret|token|url/i);
  });

  it("fails closed when any DR invariant is blocked", async () => {
    process.env.DR_OPERATOR_PROBE_ENABLED = "true";
    mocks.getReadiness.mockResolvedValue({
      status: "BLOCKED",
      checks: { writerFence: false },
    });
    const route = await import("./route");
    const response = await route.GET();

    expect(response.status).toBe(503);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      "warn",
      "DR_OPERATOR_READINESS_BLOCKED",
      expect.objectContaining({ blockedChecks: "writerFence" }),
    );
  });
});
