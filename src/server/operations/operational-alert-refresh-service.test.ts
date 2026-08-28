import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  stateUpdate: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
    operationalAlertRefreshState: { update: mocks.stateUpdate },
  },
}));

import { processDueOperationalAlertRefreshes } from "./operational-alert-refresh-service";

describe("operational alert background refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeRaw.mockResolvedValue(0);
    mocks.stateUpdate.mockResolvedValue({});
  });

  it("claims a bounded batch with skip-locked deduplication and releases successful claims", async () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    mocks.queryRaw
      .mockResolvedValueOnce([{ organizationId }])
      .mockResolvedValueOnce([{ refresh_operational_alerts_bounded: 0 }]);

    await expect(processDueOperationalAlertRefreshes(10)).resolves.toEqual({
      claimed: 1,
      refreshed: 1,
      failed: 0,
    });

    const claimSql = mocks.queryRaw.mock.calls[0]?.[0] as { strings?: string[] };
    expect(claimSql.strings?.join(" ")).toContain("skip locked");
    expect(mocks.stateUpdate).toHaveBeenCalledWith({
      where: { organizationId },
      data: expect.objectContaining({ claimedAt: null, lastErrorCode: null }),
    });
  });
});
