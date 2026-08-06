import { beforeEach, describe, expect, it, vi } from "vitest";

const qrCodeFindUnique = vi.fn();
const stallProductFindMany = vi.fn();
const settingsFindUnique = vi.fn();
const queryRaw = vi.fn();
const calculateCapacitySnapshot = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (operation: () => unknown) => operation,
}));
vi.mock("@/lib/capacity", () => ({ calculateCapacitySnapshot }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    qrCode: { findUnique: qrCodeFindUnique },
    stall: { findUnique: vi.fn() },
    stallProduct: { findMany: stallProductFindMany },
    stallOrderingSettings: { findUnique: settingsFindUnique },
    $queryRaw: queryRaw,
  },
}));

describe("Next public preorder menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qrCodeFindUnique.mockResolvedValue({
      stallId: "stall-a",
      state: "ACTIVE",
      expiresAt: null,
      fulfillmentTypeContext: "TAKEOUT",
      diningTable: null,
      location: null,
      marketEvent: null,
      stallSchedule: null,
      stall: {
        name: "預約攤位",
        slug: "preorder-stall",
        location: "台北",
        currency: "TWD",
        isActive: true,
        orderingEnabled: true,
        businessStatus: "CLOSED",
        orderingState: "CLOSED",
        isSoldOut: false,
        organization: { status: "ACTIVE" },
        orderingSettings: {
          dineInEnabled: true,
          deliveryModuleEnabled: false,
          takeoutPreorderEnabled: true,
          lotteryEnabled: true,
        },
      },
    });
    stallProductFindMany.mockResolvedValue([{
      priceOverride: null,
      sortOrder: 0,
      availableFrom: new Date("2099-08-03T04:00:00.000Z"),
      availableUntil: new Date("2099-08-03T06:00:00.000Z"),
      product: {
        id: "future-lunch",
        organizationId: "organization-a",
        name: "明日午餐",
        description: "",
        defaultPrice: 120,
        kind: "SINGLE",
        imageUrl: null,
        sortOrder: 0,
        category: { name: "主餐", sortOrder: 0 },
        translations: [],
        bundleChoiceGroups: [],
        noteGroupAssignments: [],
      },
    }]);
    settingsFindUnique.mockResolvedValue({
      maxItemQuantity: 20,
      maxUniqueProducts: 20,
      maxTotalQuantity: 50,
      maxNoteLength: 200,
      enabledLocales: ["zh-TW"],
      estimatedWaitMinutes: 10,
    });
    queryRaw.mockImplementation((template: TemplateStringsArray) => (
      String(template).includes("get_takeout_preorder_slots")
        ? [{ slots: ["2099-08-03T05:00:00.000Z"] }]
        : []
    ));
  });

  it("loads future assignments for offered slots and disables lottery in PREORDER", async () => {
    const { getCachedPublicMenuForQrToken } = await import("./public-menu");
    const menu = await getCachedPublicMenuForQrToken("preorder-qr");

    expect(menu).toMatchObject({
      orderingMode: "PREORDER",
      lotteryEnabled: false,
      preorderSlots: ["2099-08-03T05:00:00.000Z"],
      products: [{
        id: "future-lunch",
        availableFrom: "2099-08-03T04:00:00.000Z",
        availableUntil: "2099-08-03T06:00:00.000Z",
      }],
    });
    expect(calculateCapacitySnapshot).not.toHaveBeenCalled();
    const query = stallProductFindMany.mock.calls[0]?.[0];
    expect(query.where.OR).toBeUndefined();
    expect(query.where.AND).toBeUndefined();
  });

  it("offers configured slots as an optional time while live takeaway ordering remains DEFAULT", async () => {
    const context = await qrCodeFindUnique();
    qrCodeFindUnique.mockClear();
    qrCodeFindUnique.mockResolvedValue({
      ...context,
      stall: {
        ...context.stall,
        businessStatus: "OPEN",
        orderingState: "OPEN",
        orderingEnabled: true,
      },
    });
    stallProductFindMany.mockResolvedValue([{
      ...(await stallProductFindMany())[0],
      availableFrom: null,
      availableUntil: null,
    }]);
    calculateCapacitySnapshot.mockResolvedValue({
      quoteMinMinutes: 10,
      quoteMaxMinutes: 15,
      acknowledgmentThresholdMinutes: 30,
      requiresAcknowledgment: false,
    });
    const { getCachedPublicMenuForQrToken } = await import("./public-menu");

    const menu = await getCachedPublicMenuForQrToken("live-takeaway-qr", "DEFAULT");

    expect(menu).toMatchObject({
      orderingMode: "DEFAULT",
      preorderSlots: ["2099-08-03T05:00:00.000Z"],
    });
  });

  it("offers fulfillment slots to a delivery-only QR session", async () => {
    const context = await qrCodeFindUnique();
    qrCodeFindUnique.mockClear();
    qrCodeFindUnique.mockResolvedValue({
      ...context,
      fulfillmentTypeContext: "DELIVERY",
      stall: {
        ...context.stall,
        businessStatus: "OPEN",
        orderingState: "OPEN",
        orderingEnabled: true,
        orderingSettings: {
          ...context.stall.orderingSettings,
          deliveryModuleEnabled: true,
          takeoutPreorderEnabled: false,
        },
      },
    });
    stallProductFindMany.mockResolvedValue([{
      ...(await stallProductFindMany())[0],
      availableFrom: null,
      availableUntil: null,
    }]);
    const { getCachedPublicMenuForQrToken } = await import("./public-menu");

    const menu = await getCachedPublicMenuForQrToken("delivery-only-qr", "DELIVERY");

    expect(menu).toMatchObject({
      orderingMode: "DELIVERY",
      preorderSlots: ["2099-08-03T05:00:00.000Z"],
      stall: { fulfillmentType: "DELIVERY" },
    });
    expect(queryRaw.mock.calls.some(([template]) => (
      String(template).includes("get_takeout_preorder_slots")
    ))).toBe(true);
  });

  it("does not offer takeaway slots when only delivery is enabled", async () => {
    const context = await qrCodeFindUnique();
    qrCodeFindUnique.mockClear();
    qrCodeFindUnique.mockResolvedValue({
      ...context,
      stall: {
        ...context.stall,
        businessStatus: "OPEN",
        orderingState: "OPEN",
        orderingEnabled: true,
        orderingSettings: {
          ...context.stall.orderingSettings,
          deliveryModuleEnabled: true,
          takeoutPreorderEnabled: false,
        },
      },
    });
    stallProductFindMany.mockResolvedValue([{
      ...(await stallProductFindMany())[0],
      availableFrom: null,
      availableUntil: null,
    }]);
    const { getCachedPublicMenuForQrToken } = await import("./public-menu");

    const menu = await getCachedPublicMenuForQrToken("takeaway-with-delivery-only-qr", "DEFAULT");

    expect(menu).toMatchObject({ orderingMode: "DEFAULT", preorderSlots: [] });
    expect(queryRaw.mock.calls.some(([template]) => (
      String(template).includes("get_takeout_preorder_slots")
    ))).toBe(false);
  });

  it("keeps an optional bundle group visible when its add-on is unavailable", async () => {
    stallProductFindMany.mockResolvedValue([{
      priceOverride: null,
      sortOrder: 0,
      availableFrom: null,
      availableUntil: null,
      product: {
        id: "optional-bundle",
        organizationId: "organization-a",
        name: "可選加購套餐",
        description: "",
        defaultPrice: 150,
        kind: "BUNDLE",
        imageUrl: null,
        isOrderDiscountEligible: true,
        sortOrder: 0,
        category: { name: "套餐", sortOrder: 0 },
        translations: [],
        bundleChoiceGroups: [{
          id: "optional-group",
          organizationId: "organization-a",
          bundleProductId: "optional-bundle",
          name: "可選加購",
          minSelections: 0,
          maxSelections: 1,
          sortOrder: 0,
          choices: [{
            id: "sold-out-addon-choice",
            organizationId: "organization-a",
            choiceGroupId: "optional-group",
            componentProductId: "sold-out-addon",
            quantity: 1,
            priceDelta: 20,
            sortOrder: 0,
            componentProduct: {
              organizationId: "organization-a",
              kind: "SINGLE",
              isActive: true,
              name: "已售罄加購",
            },
          }],
        }],
        noteGroupAssignments: [],
      },
    }]);
    const { getCachedPublicMenuForQrToken } = await import("./public-menu");

    const menu = await getCachedPublicMenuForQrToken("optional-bundle-qr");

    expect(menu?.products).toMatchObject([{
      id: "optional-bundle",
      kind: "BUNDLE",
      bundleChoiceGroups: [{
        id: "optional-group",
        minSelections: 0,
        options: [],
      }],
    }]);
  });
});
