import { beforeEach, describe, expect, it, vi } from "vitest";

const stallId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const tableId = "33333333-3333-4333-8333-333333333333";
const floorId = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  tableFindFirst: vi.fn(),
  orderCount: vi.fn(),
  tableUpdate: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555555" } },
    stall: { id: stallId, organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.readJson.mockResolvedValue({ data: { serviceState: "NEEDS_CLEANING" } });
  mocks.queryRaw.mockResolvedValue([]);
  mocks.tableFindFirst.mockResolvedValue({
    id: tableId,
    serviceState: "OCCUPIED",
    seatedAt: new Date("2026-08-05T09:00:00.000Z"),
    cleanedAt: null,
  });
  mocks.orderCount.mockResolvedValue(0);
  mocks.tableUpdate.mockResolvedValue({
    id: tableId,
    floorId,
    code: "F2-01",
    label: "二樓菱形桌",
    isActive: true,
    layoutX: 24,
    layoutY: 36,
    shape: "DIAMOND",
    rotationDegrees: 45,
    serviceState: "NEEDS_CLEANING",
    seatedAt: new Date("2026-08-05T09:00:00.000Z"),
    cleanedAt: null,
  });
  mocks.transaction.mockImplementation(async (operation) => operation({
    $queryRaw: mocks.queryRaw,
    diningTable: {
      findFirst: mocks.tableFindFirst,
      update: mocks.tableUpdate,
    },
    order: { count: mocks.orderCount },
  }));
});

describe("table service-state presentation payload", () => {
  it("preserves the floor and table shape when the client replaces the updated table", async () => {
    const route = await import("./route");
    const response = await route.PATCH(
      new Request("https://example.test/api/stalls/demo/tables/table/service-state", {
        method: "PATCH",
        body: JSON.stringify({ serviceState: "NEEDS_CLEANING" }),
      }),
      { params: Promise.resolve({ stallSlug: "demo", tableId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.tableUpdate).toHaveBeenCalledWith({
      where: { id: tableId },
      data: {
        serviceState: "NEEDS_CLEANING",
        seatedAt: expect.any(Date),
        cleanedAt: null,
      },
      select: {
        id: true,
        floorId: true,
        code: true,
        label: true,
        isActive: true,
        layoutX: true,
        layoutY: true,
        shape: true,
        rotationDegrees: true,
        serviceState: true,
        seatedAt: true,
        cleanedAt: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      table: {
        id: tableId,
        floorId,
        shape: "DIAMOND",
        rotationDegrees: 45,
        serviceState: "NEEDS_CLEANING",
      },
    });
  });
});
