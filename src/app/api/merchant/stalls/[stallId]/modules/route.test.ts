import { beforeEach, describe, expect, it, vi } from "vitest";

const stallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const firstDiscountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const secondDiscountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  qrFindMany: vi.fn(),
  qrFindFirst: vi.fn(),
  settingsFindUnique: vi.fn(),
  transaction: vi.fn(),
  discountFindMany: vi.fn(),
  discountFindFirst: vi.fn(),
  discountUpdate: vi.fn(),
  discountDelete: vi.fn(),
  settingsUpdate: vi.fn(),
  settingsUpdateMany: vi.fn(),
  orderSessionUpdateMany: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  getState: vi.fn(),
  recordAuditEvent: vi.fn(),
  invalidatePublicMenu: vi.fn(),
  invalidatePublicQrToken: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  entitlementErrorResponse: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeStallManagementApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({
  hashClientIp: () => "ip-hash",
  createOpaqueToken: () => "local-token",
}));
vi.mock("@/lib/public-menu", () => ({
  invalidatePublicMenu: mocks.invalidatePublicMenu,
  invalidatePublicQrToken: mocks.invalidatePublicQrToken,
}));
vi.mock("@/lib/stall-modules", () => ({ getStallModuleState: mocks.getState }));
vi.mock("@/server/billing/entitlement-http", () => ({
  entitlementErrorResponse: mocks.entitlementErrorResponse,
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: {
    assertLimitAvailable: vi.fn(),
    assertFeatureEnabled: mocks.assertFeatureEnabled,
  },
}));
vi.mock("@/server/dining-floor-service", () => ({
  DiningFloorNotFoundError: class DiningFloorNotFoundError extends Error {},
  materializeDefaultDiningFloorForFloorCreation: vi.fn(),
  resolveDiningFloorIdForWrite: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    qrCode: { findMany: mocks.qrFindMany, findFirst: mocks.qrFindFirst },
    stallOrderingSettings: { findUnique: mocks.settingsFindUnique },
    $transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-id",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    workspace: { id: organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.qrFindMany.mockResolvedValue([]);
  mocks.qrFindFirst.mockResolvedValue(null);
  mocks.settingsFindUnique.mockResolvedValue({ printModuleEnabled: false });
  mocks.assertFeatureEnabled.mockResolvedValue({ featureCode: "PRINTER_INTEGRATION" });
  mocks.entitlementErrorResponse.mockReturnValue(null);
  mocks.getState.mockResolvedValue({ settings: {} });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.queryRaw.mockResolvedValue([{
    discountOptionId: secondDiscountId,
    winRateBps: 5000,
  }]);
  mocks.settingsUpdate.mockResolvedValue({ stallId });
  mocks.settingsUpdateMany.mockResolvedValue({ count: 1 });
  mocks.orderSessionUpdateMany.mockResolvedValue({ count: 0 });
  mocks.discountUpdate.mockResolvedValue({ id: firstDiscountId });
  mocks.transaction.mockImplementation(async (operation) => operation({
    discountOption: {
      findMany: mocks.discountFindMany,
      findFirst: mocks.discountFindFirst,
      update: mocks.discountUpdate,
      delete: mocks.discountDelete,
    },
    stallOrderingSettings: {
      update: mocks.settingsUpdate,
      updateMany: mocks.settingsUpdateMany,
    },
    orderSession: { updateMany: mocks.orderSessionUpdateMany },
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
  }));
});

describe("merchant printer module entitlement", () => {
  it("checks printer entitlement before enabling the stall module", async () => {
    mocks.discountFindMany.mockResolvedValue([
      { id: firstDiscountId },
      { id: secondDiscountId },
    ]);
    mocks.readJson.mockResolvedValue({
      data: { ...updateModulesCommand(), printModuleEnabled: true },
    });

    const response = await patchModules();

    expect(response.status).toBe(200);
    expect(mocks.settingsFindUnique).toHaveBeenCalledWith({
      where: { stallId },
      select: { printModuleEnabled: true },
    });
    expect(mocks.assertFeatureEnabled).toHaveBeenCalledWith(
      organizationId,
      "PRINTER_INTEGRATION",
    );
    expect(mocks.settingsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { stallId, organizationId },
      data: expect.objectContaining({ printModuleEnabled: true }),
    }));
  });

  it("does not write settings when printer entitlement is denied", async () => {
    const denial = new Error("FEATURE_NOT_INCLUDED");
    mocks.assertFeatureEnabled.mockRejectedValue(denial);
    mocks.entitlementErrorResponse.mockReturnValue(Response.json(
      { code: "FEATURE_NOT_INCLUDED" },
      { status: 403 },
    ));
    mocks.readJson.mockResolvedValue({
      data: { ...updateModulesCommand(), printModuleEnabled: true },
    });

    const response = await patchModules();

    expect(response.status).toBe(403);
    expect(mocks.entitlementErrorResponse).toHaveBeenCalledWith(denial, "request-id");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
  });

  it("does not require a printer entitlement when disabling the module", async () => {
    mocks.discountFindMany.mockResolvedValue([
      { id: firstDiscountId },
      { id: secondDiscountId },
    ]);
    mocks.readJson.mockResolvedValue({ data: updateModulesCommand() });

    const response = await patchModules();

    expect(response.status).toBe(200);
    expect(mocks.settingsFindUnique).not.toHaveBeenCalled();
    expect(mocks.assertFeatureEnabled).not.toHaveBeenCalled();
  });
});

describe("merchant lottery module writes", () => {
  it("validates enabled discounts and atomically replaces the weighted prize rows", async () => {
    mocks.discountFindMany.mockResolvedValue([
      { id: firstDiscountId },
      { id: secondDiscountId },
    ]);
    mocks.readJson.mockResolvedValue({ data: updateModulesCommand() });

    const response = await patchModules();

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.discountFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: [firstDiscountId, secondDiscountId] },
        organizationId,
        stallId,
        isEnabled: true,
      },
      select: { id: true },
    });
    expect(mocks.settingsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { stallId, organizationId },
      data: expect.objectContaining({
        lotteryEnabled: true,
        lotteryDiscountOptionId: firstDiscountId,
        lotteryDiscountWinRateBps: 2500,
      }),
    }));
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(sqlText(mocks.executeRaw.mock.calls[0]?.[0])).toContain(
      "delete from public.stall_lottery_discount_chances",
    );
    expect(sqlText(mocks.executeRaw.mock.calls[1]?.[0])).toContain(
      "insert into public.stall_lottery_discount_chances",
    );
  });

  it("rejects a disabled or cross-stall prize before changing settings", async () => {
    mocks.discountFindMany.mockResolvedValue([{ id: firstDiscountId }]);
    mocks.readJson.mockResolvedValue({ data: updateModulesCommand() });

    const response = await patchModules();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      fieldErrors: {
        lotteryDiscountChances: "抽抽樂折扣已停用或不存在，請重新選擇。",
      },
    });
    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("removes a discount from the weighted pool when the merchant disables it", async () => {
    mocks.discountFindFirst.mockResolvedValue({ id: firstDiscountId });
    mocks.readJson.mockResolvedValue({
      data: {
        operation: "UPDATE_DISCOUNT",
        discountId: firstDiscountId,
        name: "九折",
        rateBps: 9000,
        isEnabled: false,
        sortOrder: 1,
      },
    });

    const response = await patchModules();

    expect(response.status).toBe(200);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(sqlText(mocks.executeRaw.mock.calls[0]?.[0])).toContain(
      "delete from public.stall_lottery_discount_chances",
    );
    expect(mocks.settingsUpdate).toHaveBeenCalledWith({
      where: { stallId, organizationId },
      data: {
        lotteryDiscountOptionId: secondDiscountId,
        lotteryDiscountWinRateBps: 5000,
      },
    });
  });

  it("promotes the next weighted prize after deleting the compatibility snapshot", async () => {
    mocks.discountFindFirst.mockResolvedValue({ id: firstDiscountId });
    mocks.readJson.mockResolvedValue({
      data: { operation: "DELETE_DISCOUNT", discountId: firstDiscountId },
    });

    const response = await patchModules();

    expect(response.status).toBe(200);
    expect(mocks.discountDelete).toHaveBeenCalledWith({ where: { id: firstDiscountId } });
    expect(mocks.settingsUpdate).toHaveBeenCalledWith({
      where: { stallId, organizationId },
      data: {
        lotteryDiscountOptionId: secondDiscountId,
        lotteryDiscountWinRateBps: 5000,
      },
    });
  });
});

function updateModulesCommand() {
  return {
    operation: "UPDATE_MODULES",
    dineInEnabled: false,
    deliveryModuleEnabled: false,
    staffDeliveryEnabled: false,
    printModuleEnabled: false,
    paymentModuleEnabled: true,
    discountModuleEnabled: true,
    discountApprovalThresholdBps: 8000,
    takeoutPreorderEnabled: false,
    preorderMinLeadMinutes: 15,
    preorderMaxDays: 1,
    preorderSlotMinutes: 30,
    lotteryEnabled: true,
    lotteryDiscountOptionId: firstDiscountId,
    lotteryDiscountWinRateBps: 2500,
    lotteryDiscountChances: [
      { discountOptionId: firstDiscountId, winRateBps: 2500 },
      { discountOptionId: secondDiscountId, winRateBps: 5000 },
    ],
  };
}

async function patchModules() {
  const route = await import("./route");
  return route.PATCH(
    new Request(`https://local.test/api/merchant/stalls/${stallId}/modules`, {
      method: "PATCH",
      body: "{}",
    }),
    { params: Promise.resolve({ stallId }) },
  );
}

function sqlText(query: unknown) {
  if (!query || typeof query !== "object" || !("strings" in query)) return "";
  return Array.from((query as { strings: readonly string[] }).strings).join("?");
}
