import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  alertCount: vi.fn(),
  alertFindMany: vi.fn(),
  auditCount: vi.fn(),
  auditFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    operationalAlert: { count: mocks.alertCount, findMany: mocks.alertFindMany },
    auditLog: { count: mocks.auditCount, findMany: mocks.auditFindMany },
  },
}));

import { getOperationsConsoleData } from "./operations-data";

describe("operations historical query boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([]);
    mocks.alertCount.mockResolvedValue(0);
    mocks.alertFindMany.mockResolvedValue([]);
    mocks.auditCount.mockResolvedValue(0);
    mocks.auditFindMany.mockResolvedValue([]);
  });

  it("applies the same bounded Taipei date range to alerts and audit logs", async () => {
    await getOperationsConsoleData({
      organizationId: "11111111-1111-4111-8111-111111111111",
      alertStallIds: ["22222222-2222-4222-8222-222222222222"],
      auditStallIds: ["22222222-2222-4222-8222-222222222222"],
      canViewAudit: true,
      filters: { dateFrom: "2026-08-28", dateTo: "2026-08-28" },
      pagination: {
        alerts: { page: 1, pageSize: 25 },
        auditLogs: { page: 1, pageSize: 25 },
      },
    });

    const expectedRange = {
      gte: new Date("2026-08-27T16:00:00Z"),
      lt: new Date("2026-08-28T16:00:00Z"),
    };
    expect(mocks.alertCount).toHaveBeenCalledWith({
      where: expect.objectContaining({ detectedAt: expectedRange }),
    });
    expect(mocks.auditCount).toHaveBeenCalledWith({
      where: expect.objectContaining({ createdAt: expectedRange }),
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
