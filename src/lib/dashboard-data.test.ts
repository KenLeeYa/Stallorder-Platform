import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  summaryFindMany: vi.fn(),
  alertFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    dailyStallSummary: { findMany: mocks.summaryFindMany },
    operationalAlert: { findMany: mocks.alertFindMany },
  },
}));

import { getDashboardOverview } from "./dashboard-data";

describe("dashboard alert reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.summaryFindMany.mockResolvedValue([]);
    mocks.alertFindMany.mockResolvedValue([]);
  });

  it("does not mutate or refresh organization alerts during a page read", async () => {
    await getDashboardOverview({
      organizationId: "11111111-1111-4111-8111-111111111111",
      stalls: [{
        id: "22222222-2222-4222-8222-222222222222",
        organizationId: "11111111-1111-4111-8111-111111111111",
        name: "測試攤位",
        slug: "test-stall",
        code: "S001",
        roles: ["STALL_MANAGER"],
        businessStatus: "OPEN",
        orderingEnabled: true,
        isActive: true,
        kdsEnabled: true,
      }],
      alertStallIds: ["22222222-2222-4222-8222-222222222222"],
      dateFrom: "2026-08-28",
      dateTo: "2026-08-28",
    });

    expect(mocks.alertFindMany).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
