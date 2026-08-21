import { beforeEach, describe, expect, it, vi } from "vitest";

const stallFindUnique = vi.fn();
const stallProductFindMany = vi.fn();
const settingsFindUnique = vi.fn();
const specialClosureFindMany = vi.fn();
const queryRaw = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (operation: () => unknown) => operation,
}));
vi.mock("@/lib/capacity", () => ({
  calculateCapacitySnapshot: vi.fn().mockResolvedValue({
    quoteMinMinutes: 5,
    quoteMaxMinutes: 10,
    acknowledgmentThresholdMinutes: null,
    requiresAcknowledgment: false,
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stall: { findUnique: stallFindUnique },
    stallProduct: { findMany: stallProductFindMany },
    stallOrderingSettings: { findUnique: settingsFindUnique },
    stallSpecialClosure: { findMany: specialClosureFindMany },
    $queryRaw: queryRaw,
  },
}));

const category = { name: "主餐", sortOrder: 0 };
const baseProduct = {
  organizationId: "organization-a",
  description: "",
  defaultPrice: 100,
  imageUrl: null,
  sortOrder: 0,
  category,
  translations: [],
  noteGroupAssignments: [],
};

describe("public bundle menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stallFindUnique.mockResolvedValue({
      id: "stall-a",
      name: "測試攤位",
      slug: "test-stall",
      location: "台北",
      currency: "TWD",
      timezone: "Asia/Taipei",
      isActive: true,
      orderingEnabled: true,
      businessStatus: "OPEN",
      orderingState: "OPEN",
      isSoldOut: false,
      organization: { status: "ACTIVE" },
    });
    settingsFindUnique.mockResolvedValue({
      maxItemQuantity: 20,
      maxUniqueProducts: 20,
      maxTotalQuantity: 50,
      maxNoteLength: 200,
      enabledLocales: ["zh-TW"],
      estimatedWaitMinutes: 10,
    });
    queryRaw.mockResolvedValue([]);
    specialClosureFindMany.mockResolvedValue([]);
  });

  it("publishes complete bundles and hides bundles without enough saleable choices", async () => {
    const component = {
      id: "component-a",
      name: "薯條",
      kind: "SINGLE",
      isActive: true,
      organizationId: "organization-a",
    };
    stallProductFindMany.mockResolvedValue([
      {
        priceOverride: null,
        sortOrder: 1,
        product: {
          ...baseProduct,
          id: component.id,
          name: component.name,
          kind: "SINGLE",
          bundleChoiceGroups: [],
        },
      },
      {
        priceOverride: 180,
        sortOrder: 2,
        product: {
          ...baseProduct,
          id: "bundle-valid",
          name: "超值套餐",
          kind: "BUNDLE",
          bundleChoiceGroups: [{
            id: "group-valid",
            organizationId: "organization-a",
            name: "配餐",
            minSelections: 1,
            maxSelections: 1,
            sortOrder: 3,
            choices: [{
              id: "choice-valid",
              organizationId: "organization-a",
              componentProductId: component.id,
              quantity: 2,
              priceDelta: 20,
              sortOrder: 4,
              componentProduct: component,
            }],
          }],
        },
      },
      {
        priceOverride: null,
        sortOrder: 3,
        product: {
          ...baseProduct,
          id: "bundle-incomplete",
          name: "缺貨套餐",
          kind: "BUNDLE",
          bundleChoiceGroups: [{
            id: "group-incomplete",
            organizationId: "organization-a",
            name: "飲料",
            minSelections: 1,
            maxSelections: 1,
            sortOrder: 0,
            choices: [{
              id: "choice-unavailable",
              organizationId: "organization-a",
              componentProductId: "component-unavailable",
              quantity: 1,
              priceDelta: 0,
              sortOrder: 0,
              componentProduct: {
                ...component,
                id: "component-unavailable",
                name: "缺貨飲料",
              },
            }],
          }],
        },
      },
    ]);

    const { getCachedPublicMenuForStallSlug } = await import("./public-menu");
    const menu = await getCachedPublicMenuForStallSlug("test-stall");

    expect(menu?.products.map((product) => product.id)).toEqual(["component-a", "bundle-valid"]);
    expect(menu?.products[0]).toMatchObject({ kind: "SINGLE", bundleChoiceGroups: [] });
    expect(menu?.products[1]).toMatchObject({
      id: "bundle-valid",
      price: 180,
      kind: "BUNDLE",
      bundleChoiceGroups: [{
        id: "group-valid",
        name: "配餐",
        minSelections: 1,
        maxSelections: 1,
        sortOrder: 3,
        options: [{
          id: "choice-valid",
          componentProductId: "component-a",
          componentProductName: "薯條",
          quantity: 2,
          priceDelta: 20,
          sortOrder: 4,
        }],
      }],
    });
  });

  it("keeps the read-only display menu available while live ordering is paused", async () => {
    stallFindUnique.mockResolvedValue({
      id: "stall-a",
      name: "測試攤位",
      slug: "test-stall",
      location: "台北",
      currency: "TWD",
      timezone: "Asia/Taipei",
      isActive: true,
      orderingEnabled: false,
      businessStatus: "CLOSED",
      orderingState: "PAUSED",
      isSoldOut: false,
      organization: { status: "ACTIVE" },
    });
    stallProductFindMany.mockResolvedValue([{
      priceOverride: null,
      sortOrder: 1,
      availableFrom: new Date("2099-01-01T00:00:00.000Z"),
      availableUntil: null,
      product: {
        ...baseProduct,
        id: "product-a",
        name: "展示商品",
        kind: "SINGLE",
        bundleChoiceGroups: [],
      },
    }]);

    const {
      getCachedPublicDisplayMenuForStallSlug,
      getCachedPublicMenuForStallSlug,
    } = await import("./public-menu");

    await expect(getCachedPublicMenuForStallSlug("test-stall")).resolves.toBeNull();
    const displayMenu = await getCachedPublicDisplayMenuForStallSlug("test-stall");
    expect(displayMenu?.products.map((product) => product.name)).toEqual(["展示商品"]);
    expect(displayMenu?.products[0]?.availableFrom).toBe("2099-01-01T00:00:00.000Z");
    expect(displayMenu?.stall).toMatchObject({ name: "測試攤位", slug: "test-stall" });
  });

  it("does not expose a display menu for a disabled tenant", async () => {
    stallFindUnique.mockResolvedValue({
      id: "stall-a",
      name: "停權攤位",
      slug: "disabled-stall",
      location: "台北",
      currency: "TWD",
      timezone: "Asia/Taipei",
      isActive: true,
      orderingEnabled: true,
      businessStatus: "OPEN",
      orderingState: "OPEN",
      isSoldOut: false,
      organization: { status: "SUSPENDED" },
    });
    const { getCachedPublicDisplayMenuForStallSlug } = await import("./public-menu");

    await expect(getCachedPublicDisplayMenuForStallSlug("disabled-stall")).resolves.toBeNull();
    expect(stallProductFindMany).not.toHaveBeenCalled();
  });
});
