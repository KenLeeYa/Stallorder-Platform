import { beforeEach, describe, expect, it, vi } from "vitest";

const sourceStallId = "11111111-1111-4111-8111-111111111111";
const targetStallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const sourceDiscountId = "44444444-4444-4444-8444-444444444444";
const targetDiscountId = "55555555-5555-4555-8555-555555555555";
const secondSourceDiscountId = "44444444-4444-4444-8444-444444444445";
const secondTargetDiscountId = "55555555-5555-4555-8555-555555555556";
const sourceProductId = "77777777-7777-4777-8777-777777777777";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  loadTemplate: vi.fn(),
  getPreview: vi.fn(),
  transaction: vi.fn(),
  settingsUpdate: vi.fn(),
  discountDeleteMany: vi.fn(),
  discountCreateMany: vi.fn(),
  discountFindMany: vi.fn(),
  executeRaw: vi.fn(),
  orderSessionUpdateMany: vi.fn(),
  lotteryCampaignUpdateMany: vi.fn(),
  lotteryCampaignCreateMany: vi.fn(),
  recordAuditEvent: vi.fn(),
  invalidatePublicMenu: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeStallManagementApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/rbac", () => ({ hasPermission: () => true }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/public-menu", () => ({ invalidatePublicMenu: mocks.invalidatePublicMenu }));
vi.mock("@/lib/stall-template", () => ({
  applyStallTemplateSchema: {
    safeParse: (data: unknown) => ({ success: true, data }),
  },
  loadStallTemplateData: mocks.loadTemplate,
  getStallTemplatePreview: mocks.getPreview,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

const sourceTemplate = {
  stall: { id: sourceStallId, name: "來源攤位" },
  paymentOptions: [],
  discounts: [
    {
      id: sourceDiscountId,
      organizationId,
      stallId: sourceStallId,
      name: "抽抽樂九折",
      rateBps: 9000,
      isEnabled: true,
      sortOrder: 1,
    },
    {
      id: secondSourceDiscountId,
      organizationId,
      stallId: sourceStallId,
      name: "抽抽樂八折",
      rateBps: 8000,
      isEnabled: true,
      sortOrder: 2,
    },
  ],
  lotteryDiscountChances: [
    { discountOptionId: sourceDiscountId, winRateBps: 2500 },
    { discountOptionId: secondSourceDiscountId, winRateBps: 5000 },
  ],
  stallProducts: [],
  businessHours: [],
  lotteryFestivalCampaigns: [
    {
      id: "88888888-8888-4888-8888-888888888888",
      organizationId,
      stallId: sourceStallId,
      name: "中秋節",
      isEnabled: true,
      startsOn: new Date("2026-09-20T00:00:00.000Z"),
      endsOn: new Date("2026-09-27T00:00:00.000Z"),
      productIds: [sourceProductId],
      sortOrder: 0,
      deletedAt: null,
    },
  ],
  settings: {
    paymentModuleEnabled: true,
    discountModuleEnabled: true,
    discountApprovalThresholdBps: 8000,
    staffDeliveryEnabled: true,
    deliveryCustomerNotice: "請留意外送通知",
    takeoutPreorderEnabled: true,
    preorderMinLeadMinutes: 90,
    preorderMaxDays: 14,
    preorderSlotMinutes: 60,
    lotteryEnabled: true,
    lotteryCampaignName: "抽抽樂",
    lotteryProductIds: [sourceProductId],
    lotteryDiscountOptionId: sourceDiscountId,
    lotteryDiscountWinRateBps: 2500,
    lotterySpendRewardEnabled: true,
    lotterySpendThresholdAmount: 666,
    lotteryFestivalRewardEnabled: true,
    lotteryFestivalStartsOn: new Date("2026-12-24T00:00:00.000Z"),
    lotteryFestivalEndsOn: new Date("2026-12-25T00:00:00.000Z"),
    lotteryBirthdayRewardEnabled: false,
  },
};

const targetTemplate = {
  ...sourceTemplate,
  stall: { id: targetStallId, name: "目標攤位" },
  discounts: sourceTemplate.discounts.map((discount, index) => ({
    ...discount,
    id: index === 0 ? targetDiscountId : secondTargetDiscountId,
    stallId: targetStallId,
  })),
  lotteryDiscountChances: [
    { discountOptionId: targetDiscountId, winRateBps: 2500 },
    { discountOptionId: secondTargetDiscountId, winRateBps: 5000 },
  ],
  settings: {
    ...sourceTemplate.settings,
    lotteryDiscountOptionId: targetDiscountId,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "66666666-6666-4666-8666-666666666666" } },
    workspace: {
      id: organizationId,
      roles: ["OWNER"],
      stalls: [{ id: sourceStallId, roles: ["OWNER"] }],
    },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.loadTemplate.mockImplementation(async (stallId: string) => (
    stallId === sourceStallId ? sourceTemplate : targetTemplate
  ));
  mocks.getPreview.mockResolvedValue({ sections: [] });
  mocks.discountFindMany.mockResolvedValue([
    { id: targetDiscountId, name: "抽抽樂九折", rateBps: 9000 },
    { id: secondTargetDiscountId, name: "抽抽樂八折", rateBps: 8000 },
  ]);
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (operation) => operation({
    stallOrderingSettings: { update: mocks.settingsUpdate },
    discountOption: {
      deleteMany: mocks.discountDeleteMany,
      createMany: mocks.discountCreateMany,
      findMany: mocks.discountFindMany,
    },
    orderSession: { updateMany: mocks.orderSessionUpdateMany },
    stallLotteryCampaign: {
      updateMany: mocks.lotteryCampaignUpdateMany,
      createMany: mocks.lotteryCampaignCreateMany,
    },
    $executeRaw: mocks.executeRaw,
  }));
});

async function postTemplate(sections: string[]) {
  mocks.readJson.mockResolvedValue({ data: { sourceStallId, sections } });
  const route = await import("./route");
  return route.POST(
    new Request(`https://example.test/api/merchant/stalls/${targetStallId}/templates`, {
      method: "POST",
      body: JSON.stringify({ sourceStallId, sections }),
    }),
    { params: Promise.resolve({ stallId: targetStallId }) },
  );
}

describe("stall template ordering experience linkage", () => {
  it("copies staff delivery, preorder, and every weighted lottery discount", async () => {
    const response = await postTemplate(["ORDERING_EXPERIENCE"]);

    expect(response.status).toBe(200);
    expect(mocks.discountFindMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        stallId: targetStallId,
        isEnabled: true,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, name: true, rateBps: true },
    });
    expect(mocks.settingsUpdate).toHaveBeenCalledWith({
      where: { stallId: targetStallId },
      data: {
        staffDeliveryEnabled: true,
        deliveryCustomerNotice: "請留意外送通知",
        takeoutPreorderEnabled: true,
        preorderMinLeadMinutes: 90,
        preorderMaxDays: 14,
        preorderSlotMinutes: 60,
        lotteryEnabled: true,
        lotteryCampaignName: "抽抽樂",
        lotteryProductIds: [sourceProductId],
        lotteryDiscountOptionId: targetDiscountId,
        lotteryDiscountWinRateBps: 2500,
        lotterySpendRewardEnabled: true,
        lotterySpendThresholdAmount: 666,
        lotteryFestivalRewardEnabled: true,
        lotteryFestivalStartsOn: new Date("2026-12-24T00:00:00.000Z"),
        lotteryFestivalEndsOn: new Date("2026-12-25T00:00:00.000Z"),
        lotteryBirthdayRewardEnabled: false,
      },
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.lotteryCampaignUpdateMany).toHaveBeenCalledWith({
      where: { organizationId, stallId: targetStallId, deletedAt: null },
      data: { deletedAt: expect.any(Date), isEnabled: false },
    });
    expect(mocks.lotteryCampaignCreateMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId,
          stallId: targetStallId,
          name: "中秋節",
          isEnabled: true,
          startsOn: new Date("2026-09-20T00:00:00.000Z"),
          endsOn: new Date("2026-09-27T00:00:00.000Z"),
          productIds: [sourceProductId],
          sortOrder: 0,
        },
      ],
    });
  });

  it("remaps an existing lottery discount when only discount options are copied", async () => {
    const response = await postTemplate(["DISCOUNTS"]);

    expect(response.status).toBe(200);
    expect(mocks.settingsUpdate).toHaveBeenCalledWith({
      where: { stallId: targetStallId },
      data: {
        discountModuleEnabled: true,
        discountApprovalThresholdBps: 8000,
        lotteryDiscountOptionId: targetDiscountId,
        lotteryDiscountWinRateBps: 2500,
      },
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  });

  it("maps duplicate name-and-rate prizes to distinct target discount ids", async () => {
    const duplicateSource = {
      ...sourceTemplate,
      discounts: sourceTemplate.discounts.map((discount) => ({
        ...discount,
        name: "同名九折",
        rateBps: 9000,
      })),
    };
    const duplicateTarget = {
      ...targetTemplate,
      discounts: targetTemplate.discounts.map((discount) => ({
        ...discount,
        name: "同名九折",
        rateBps: 9000,
      })),
    };
    mocks.loadTemplate.mockImplementation(async (currentStallId: string) => (
      currentStallId === sourceStallId ? duplicateSource : duplicateTarget
    ));
    mocks.discountFindMany.mockResolvedValue([
      { id: targetDiscountId, name: "同名九折", rateBps: 9000 },
      { id: secondTargetDiscountId, name: "同名九折", rateBps: 9000 },
    ]);

    const response = await postTemplate(["ORDERING_EXPERIENCE"]);

    expect(response.status).toBe(200);
    const insertValues = sqlValues(mocks.executeRaw.mock.calls[1]?.[0]);
    const serializedChances = insertValues.find((value): value is string => (
      typeof value === "string" && value.includes("discount_option_id")
    ));
    expect(serializedChances).toBeTruthy();
    const rows = JSON.parse(serializedChances ?? "[]") as Array<{ discount_option_id: string }>;
    expect(rows.map((row) => row.discount_option_id)).toEqual([
      targetDiscountId,
      secondTargetDiscountId,
    ]);
  });

  it("revokes active preorder sessions when the copied template disables preorder", async () => {
    mocks.loadTemplate.mockImplementation(async (stallId: string) => (
      stallId === sourceStallId
        ? {
            ...sourceTemplate,
            settings: { ...sourceTemplate.settings, takeoutPreorderEnabled: false },
          }
        : targetTemplate
    ));

    const response = await postTemplate(["ORDERING_EXPERIENCE"]);

    expect(response.status).toBe(200);
    expect(mocks.orderSessionUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        stallId: targetStallId,
        orderingMode: "PREORDER",
        status: "ACTIVE",
      },
      data: { status: "REVOKED", revokedAt: expect.any(Date) },
    });
  });
});

function sqlValues(query: unknown) {
  if (!query || typeof query !== "object" || !("values" in query)) return [];
  return Array.from((query as { values: readonly unknown[] }).values);
}
