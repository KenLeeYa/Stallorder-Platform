import { beforeEach, describe, expect, it, vi } from "vitest";

const stallFindUnique = vi.fn();
const stallProductFindMany = vi.fn();
const settingsFindUnique = vi.fn();
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
});
