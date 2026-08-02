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
});
