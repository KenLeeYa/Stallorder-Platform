import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  stallProductFindMany: vi.fn(),
  diningTableFindMany: vi.fn(),
  settingsFindUniqueOrThrow: vi.fn(),
  settingsFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stallProduct: { findMany: database.stallProductFindMany },
    diningTable: { findMany: database.diningTableFindMany },
    stallOrderingSettings: {
      findUniqueOrThrow: database.settingsFindUniqueOrThrow,
      findUnique: database.settingsFindUnique,
    },
  },
}));

import { getStaffOrderPageConfiguration } from "./staff-order-catalog";

const organizationId = "10000000-0000-4000-8000-000000000001";
const stallId = "20000000-0000-4000-8000-000000000001";

function assignment(input: {
  bundleId: string;
  soldOut?: boolean;
  kind?: "SINGLE" | "BUNDLE";
  componentKind?: "SINGLE" | "BUNDLE";
  componentActive?: boolean;
  componentStallId?: string;
  minSelections?: number;
}) {
  const kind = input.kind ?? "BUNDLE";
  return {
    priceOverride: null,
    product: {
      id: input.bundleId,
      organizationId,
      name: kind === "BUNDLE" ? "招牌套餐" : "單點河粉",
      description: "",
      defaultPrice: 100,
      kind,
      imageUrl: null,
      category: { name: "主食" },
      bundleChoiceGroups: kind === "BUNDLE" ? [{
        id: `${input.bundleId.slice(0, -1)}2`,
        organizationId,
        bundleProductId: input.bundleId,
        name: "主餐",
        minSelections: input.minSelections ?? 1,
        maxSelections: 1,
        choices: [{
          id: `${input.bundleId.slice(0, -1)}3`,
          organizationId,
          choiceGroupId: `${input.bundleId.slice(0, -1)}2`,
          quantity: 1,
          priceDelta: 20,
          isEnabled: true,
          componentProduct: {
            organizationId,
            name: "河粉",
            kind: input.componentKind ?? "SINGLE",
            isActive: input.componentActive ?? true,
            category: { isActive: true },
            stallProducts: [{
              organizationId,
              stallId: input.componentStallId ?? stallId,
              isEnabled: true,
              isSoldOut: input.soldOut ?? false,
              availableFrom: null,
              availableUntil: null,
            }],
          },
        }],
      }] : [],
      noteGroupAssignments: [],
    },
  };
}

describe("店員點餐套餐目錄", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.diningTableFindMany.mockResolvedValue([]);
    database.settingsFindUniqueOrThrow.mockResolvedValue({
      dineInEnabled: false,
      staffDeliveryEnabled: false,
      printModuleEnabled: false,
      paymentModuleEnabled: true,
      discountModuleEnabled: false,
      discountApprovalThresholdBps: 8000,
      maxItemQuantity: 20,
      maxUniqueProducts: 20,
      maxTotalQuantity: 40,
      maxNoteLength: 200,
    });
  });

  it("只顯示選項元件目前可售且能完成必選群組的套餐", async () => {
    const availableBundleId = "30000000-0000-4000-8000-000000000001";
    const soldOutBundleId = "40000000-0000-4000-8000-000000000001";
    const singleId = "50000000-0000-4000-8000-000000000001";
    const nestedBundleId = "60000000-0000-4000-8000-000000000001";
    const inactiveComponentBundleId = "70000000-0000-4000-8000-000000000001";
    const wrongStallBundleId = "80000000-0000-4000-8000-000000000001";
    database.stallProductFindMany.mockResolvedValue([
      assignment({ bundleId: availableBundleId }),
      assignment({ bundleId: soldOutBundleId, soldOut: true }),
      assignment({ bundleId: nestedBundleId, componentKind: "BUNDLE" }),
      assignment({ bundleId: inactiveComponentBundleId, componentActive: false }),
      assignment({
        bundleId: wrongStallBundleId,
        componentStallId: "20000000-0000-4000-8000-000000000002",
      }),
      assignment({ bundleId: singleId, kind: "SINGLE" }),
    ]);

    const configuration = await getStaffOrderPageConfiguration(stallId, organizationId, true);

    expect(configuration.catalog?.products.map((product) => product.id)).toEqual([
      availableBundleId,
      singleId,
    ]);
    expect(configuration.catalog?.products[0]).toMatchObject({
      kind: "BUNDLE",
      price: 100,
      bundleChoiceGroups: [{
        name: "主餐",
        choices: [{ name: "河粉", quantity: 1, priceDelta: 20 }],
      }],
    });
    expect(configuration.catalog?.products[1]).toMatchObject({
      kind: "SINGLE",
      bundleChoiceGroups: [],
    });
  });

  it("keeps a bundle with an optional group when its only choice is sold out", async () => {
    const optionalBundleId = "90000000-0000-4000-8000-000000000001";
    database.stallProductFindMany.mockResolvedValue([
      assignment({ bundleId: optionalBundleId, soldOut: true, minSelections: 0 }),
    ]);

    const configuration = await getStaffOrderPageConfiguration(stallId, organizationId, true);

    expect(configuration.catalog?.products).toMatchObject([{
      id: optionalBundleId,
      kind: "BUNDLE",
      bundleChoiceGroups: [{ minSelections: 0, choices: [] }],
    }]);
  });
});
