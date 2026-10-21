import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeMobileStallRequest = vi.fn();
const getDashboardOverview = vi.fn();
const getAvailabilityConfig = vi.fn();
const getMobileSessionDeviceId = vi.fn();
const findStall = vi.fn();
const findCashShift = vi.fn();
const countPrintJobs = vi.fn();
const countProductionTasks = vi.fn();

vi.mock("@/server/mobile/authorization", () => ({ authorizeMobileStallRequest }));
vi.mock("@/lib/dashboard-data", () => ({ getDashboardOverview }));
vi.mock("@/server/resilience/availability-config-service", () => ({ getAvailabilityConfig }));
vi.mock("@/lib/auth", () => ({ getMobileSessionDeviceId }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stall: { findUnique: findStall },
    cashShift: { findFirst: findCashShift },
    printJob: { count: countPrintJobs },
    orderProductionTask: { count: countProductionTasks },
  },
}));

const authorized = {
  ok: true,
  requestId: "11111111-1111-4111-8111-111111111111",
  roles: ["ORGANIZATION_OWNER"],
  workspace: {
    id: "22222222-2222-4222-8222-222222222222",
    defaultCurrency: "TWD",
  },
  stall: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "測試攤位",
    slug: "test-stall",
    businessStatus: "OPEN",
    orderingEnabled: true,
    kdsEnabled: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  authorizeMobileStallRequest.mockResolvedValue(authorized);
  findStall.mockResolvedValue({ timezone: "Asia/Taipei" });
  getMobileSessionDeviceId.mockReturnValue("44444444-4444-4444-8444-444444444444");
  getDashboardOverview.mockResolvedValue({
    generatedAt: "2026-08-25T10:00:00.000Z",
    summary: {
      totalSales: 125000,
      orderCount: 20,
      completedOrderCount: 15,
      cancelledOrderCount: 1,
      pendingOrderCount: 4,
      averageOrderValue: 6250,
    },
    alerts: [{
      id: "55555555-5555-4555-8555-555555555555",
      severity: "WARNING",
      message: "待確認訂單增加",
      status: "ACTIVE",
      detectedAt: "2026-08-25T09:55:00.000Z",
    }],
  });
  findCashShift.mockResolvedValue({
    id: "66666666-6666-4666-8666-666666666666",
    openedAt: new Date("2026-08-25T08:00:00.000Z"),
  });
  countPrintJobs.mockResolvedValue(2);
  countProductionTasks.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
  getAvailabilityConfig.mockResolvedValue({
    mode: "NORMAL_PRIMARY",
    staffOnline: "AVAILABLE",
    updatedAt: "2026-08-25T10:00:00.000Z",
  });
});

describe("GET /api/mobile/v1/stalls/:stallId/dashboard", () => {
  it("returns scoped operational summaries from server permissions", async () => {
    const route = await import("./route");
    const response = await route.GET(
      new Request("https://example.test/api/mobile/v1/stalls/333/dashboard"),
      { params: Promise.resolve({ stallId: "33333333-3333-4333-8333-333333333333" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stall.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(body.summary.totalSales).toBe(125000);
    expect(body.pendingPrintJobCount).toBe(2);
    expect(body.kdsQueue).toEqual({ pending: 3, preparing: 1 });
    expect(getDashboardOverview).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "22222222-2222-4222-8222-222222222222",
      stalls: [authorized.stall],
    }));
  });

  it("does not query print or KDS modules for a finance-only role", async () => {
    authorizeMobileStallRequest.mockResolvedValue({ ...authorized, roles: ["FINANCE_VIEWER"] });
    const route = await import("./route");
    const response = await route.GET(
      new Request("https://example.test/api/mobile/v1/stalls/333/dashboard"),
      { params: Promise.resolve({ stallId: "33333333-3333-4333-8333-333333333333" }) },
    );
    const body = await response.json();

    expect(body.openCashShift).toEqual({
      id: "66666666-6666-4666-8666-666666666666",
      openedAt: "2026-08-25T08:00:00.000Z",
    });
    expect(body.pendingPrintJobCount).toBeNull();
    expect(body.kdsQueue).toBeNull();
    expect(findCashShift).toHaveBeenCalledTimes(1);
    expect(countPrintJobs).not.toHaveBeenCalled();
    expect(countProductionTasks).not.toHaveBeenCalled();
  });
});
