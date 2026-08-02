import { beforeEach, describe, expect, it, vi } from "vitest";

const sourceStallId = "11111111-1111-4111-8111-111111111111";
const targetStallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const sourceDiscountId = "44444444-4444-4444-8444-444444444444";
const targetDiscountId = "55555555-5555-4555-8555-555555555555";

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
  discountFindFirst: vi.fn(),
  orderSessionUpdateMany: vi.fn(),
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
  discounts: [{
    id: sourceDiscountId,
    organizationId,
    stallId: sourceStallId,
    name: "抽抽樂九折",
    rateBps: 9000,
    isEnabled: true,
    sortOrder: 1,
  }],
  stallProducts: [],
  businessHours: [],
  settings: {
    paymentModuleEnabled: true,
    discountModuleEnabled: true,
    discountApprovalThresholdBps: 8000,
    staffDeliveryEnabled: true,
    takeoutPreorderEnabled: true,
    preorderMinLeadMinutes: 90,
    preorderMaxDays: 14,
    preorderSlotMinutes: 60,
    lotteryEnabled: true,
    lotteryDiscountOptionId: sourceDiscountId,
    lotteryDiscountWinRateBps: 2500,
  },
};

const targetTemplate = {
  ...sourceTemplate,
  stall: { id: targetStallId, name: "目標攤位" },
  discounts: [{
    ...sourceTemplate.discounts[0],
    id: targetDiscountId,
    stallId: targetStallId,
  }],
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
  mocks.discountFindFirst.mockResolvedValue({ id: targetDiscountId });
  mocks.transaction.mockImplementation(async (operation) => operation({
    stallOrderingSettings: { update: mocks.settingsUpdate },
    discountOption: {
      deleteMany: mocks.discountDeleteMany,
      createMany: mocks.discountCreateMany,
      findFirst: mocks.discountFindFirst,
    },
    orderSession: { updateMany: mocks.orderSessionUpdateMany },
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
  it("copies staff delivery, preorder, and lottery settings with a target discount id", async () => {
    const response = await postTemplate(["ORDERING_EXPERIENCE"]);

    expect(response.status).toBe(200);
    expect(mocks.discountFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId,
        stallId: targetStallId,
        name: "抽抽樂九折",
        rateBps: 9000,
        isEnabled: true,
      },
      select: { id: true },
    });
    expect(mocks.settingsUpdate).toHaveBeenCalledWith({
      where: { stallId: targetStallId },
      data: {
        staffDeliveryEnabled: true,
        takeoutPreorderEnabled: true,
        preorderMinLeadMinutes: 90,
        preorderMaxDays: 14,
        preorderSlotMinutes: 60,
        lotteryEnabled: true,
        lotteryDiscountOptionId: targetDiscountId,
        lotteryDiscountWinRateBps: 2500,
      },
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
      },
    });
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
