import { describe, expect, it } from "vitest";
import type { PublicMenuProduct } from "@/lib/public-menu-types";
import {
  prunePublicCartLinesForProducts,
  prunePublicCartForProducts,
  publicMenuProductsForPickup,
  publicMenuProductsForPickupWindow,
} from "@/lib/public-menu-availability";

function product(
  input: Partial<PublicMenuProduct> & Pick<PublicMenuProduct, "id">,
): PublicMenuProduct {
  const { id, ...overrides } = input;
  return {
    id,
    name: id,
    description: "",
    price: 100,
    kind: "SINGLE",
    category: "主餐",
    rank: null,
    isBestSeller: false,
    imageUrl: null,
    translations: [],
    noteGroups: [],
    bundleChoiceGroups: [],
    ...overrides,
  };
}

describe("public preorder menu availability", () => {
  it("keeps legacy products without availability metadata and filters scheduled products by pickup time", () => {
    const products = [
      product({ id: "legacy" }),
      product({
        id: "lunch",
        availableFrom: "2026-08-03T04:00:00.000Z",
        availableUntil: "2026-08-03T06:00:00.000Z",
      }),
    ];

    expect(publicMenuProductsForPickup(products, "2026-08-03T03:30:00.000Z")
      .map((item) => item.id)).toEqual(["legacy"]);
    expect(publicMenuProductsForPickup(products, "2026-08-03T05:00:00.000Z")
      .map((item) => item.id)).toEqual(["legacy", "lunch"]);
    expect(publicMenuProductsForPickup(products, "2026-08-03T06:00:00.000Z")
      .map((item) => item.id)).toEqual(["legacy"]);
  });

  it("filters bundle choices for the selected slot and hides an incomplete bundle", () => {
    const bundle = product({
      id: "bundle",
      kind: "BUNDLE",
      bundleChoiceGroups: [{
        id: "drink",
        name: "飲料",
        minSelections: 1,
        maxSelections: 1,
        sortOrder: 0,
        options: [
          {
            id: "morning-tea",
            componentProductId: "tea",
            componentProductName: "紅茶",
            quantity: 1,
            priceDelta: 0,
            sortOrder: 0,
            availableUntil: "2026-08-03T04:00:00.000Z",
          },
          {
            id: "lunch-tea",
            componentProductId: "tea-2",
            componentProductName: "午餐紅茶",
            quantity: 1,
            priceDelta: 10,
            sortOrder: 1,
            availableFrom: "2026-08-03T04:00:00.000Z",
          },
        ],
      }],
    });

    expect(publicMenuProductsForPickup([bundle], "2026-08-03T03:00:00.000Z")[0]
      ?.bundleChoiceGroups[0]?.options.map((option) => option.id)).toEqual(["morning-tea"]);
    expect(publicMenuProductsForPickup([bundle], "2026-08-03T05:00:00.000Z")[0]
      ?.bundleChoiceGroups[0]?.options.map((option) => option.id)).toEqual(["lunch-tea"]);
    expect(publicMenuProductsForPickup([bundle], "invalid")).toEqual([]);
  });

  it("keeps an optional bundle group when no option is available in the selected slot", () => {
    const optionalBundle = product({
      id: "optional-bundle",
      kind: "BUNDLE",
      bundleChoiceGroups: [{
        id: "optional-addon",
        name: "可選加購",
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 0,
        options: [{
          id: "breakfast-addon",
          componentProductId: "addon",
          componentProductName: "早餐加購",
          quantity: 1,
          priceDelta: 20,
          sortOrder: 0,
          availableUntil: "2026-08-03T04:00:00.000Z",
        }],
      }],
    });

    const result = publicMenuProductsForPickup(
      [optionalBundle],
      "2026-08-03T05:00:00.000Z",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.bundleChoiceGroups[0]?.options).toEqual([]);
    const windowResult = publicMenuProductsForPickupWindow(
      [optionalBundle],
      ["2026-08-03T05:00:00.000Z"],
    );
    expect(windowResult).toHaveLength(1);
    expect(windowResult[0]?.bundleChoiceGroups[0]?.options).toEqual([]);
  });

  it("returns the union of products usable in at least one offered preorder slot", () => {
    const products = [
      product({
        id: "morning",
        availableUntil: "2026-08-03T04:00:00.000Z",
      }),
      product({
        id: "lunch",
        availableFrom: "2026-08-03T04:00:00.000Z",
      }),
      product({
        id: "tomorrow",
        availableFrom: "2026-08-04T00:00:00.000Z",
      }),
    ];

    expect(publicMenuProductsForPickupWindow(products, [
      "2026-08-03T03:00:00.000Z",
      "2026-08-03T05:00:00.000Z",
    ]).map((item) => item.id)).toEqual(["morning", "lunch"]);
  });

  it("removes products and bundle choices that cannot be ordered in the new slot", () => {
    const available = [product({
      id: "bundle",
      kind: "BUNDLE",
      noteGroups: [{
        id: "note",
        name: "甜度",
        selectionMode: "SINGLE",
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 0,
        translations: [],
        options: [{ id: "less-sugar", name: "少糖", priceDelta: 0, sortOrder: 0, translations: [] }],
      }],
      bundleChoiceGroups: [{
        id: "drink",
        name: "飲料",
        minSelections: 1,
        maxSelections: 1,
        sortOrder: 0,
        options: [{
          id: "lunch-tea",
          componentProductId: "tea",
          componentProductName: "午餐紅茶",
          quantity: 1,
          priceDelta: 0,
          sortOrder: 0,
        }],
      }],
    })];

    expect(prunePublicCartForProducts(available, {
      quantities: { bundle: 1, expired: 2 },
      noteSelections: { bundle: ["less-sugar", "unknown"], expired: ["x"] },
      bundleSelections: { bundle: ["morning-tea", "lunch-tea"], expired: ["x"] },
    })).toEqual({
      quantities: { bundle: 1 },
      noteSelections: { bundle: ["less-sugar"] },
      bundleSelections: { bundle: ["lunch-tea"] },
    });
  });

  it("prunes legacy menu payloads without bundle choice groups safely", () => {
    const legacyProduct = product({ id: "legacy" });
    Object.assign(legacyProduct, { bundleChoiceGroups: undefined });

    expect(prunePublicCartForProducts([legacyProduct], {
      quantities: { legacy: 1 },
      noteSelections: {},
      bundleSelections: { legacy: ["stale-choice"] },
    })).toEqual({
      quantities: { legacy: 1 },
      noteSelections: {},
      bundleSelections: {},
    });
  });

  it("preserves independent cart variants while pruning unavailable products and choices", () => {
    const available = [product({
      id: "bundle",
      noteGroups: [{
        id: "note",
        name: "甜度",
        selectionMode: "SINGLE",
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 0,
        translations: [],
        options: [{ id: "less-sugar", name: "少糖", priceDelta: 0, sortOrder: 0, translations: [] }],
      }],
      bundleChoiceGroups: [{
        id: "drink",
        name: "飲料",
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 0,
        options: [{
          id: "tea",
          componentProductId: "tea-product",
          componentProductName: "茶",
          quantity: 1,
          priceDelta: 0,
          sortOrder: 0,
        }],
      }],
    })];

    expect(prunePublicCartLinesForProducts(available, [{
      id: "first",
      productId: "bundle",
      quantity: 1,
      note: "",
      noteOptionIds: ["less-sugar", "stale-note"],
      bundleChoiceIds: ["tea", "stale-choice"],
    }, {
      id: "second",
      productId: "bundle",
      quantity: 1,
      note: "",
      noteOptionIds: [],
      bundleChoiceIds: [],
    }, {
      id: "expired",
      productId: "expired",
      quantity: 1,
      note: "",
      noteOptionIds: [],
      bundleChoiceIds: [],
    }])).toEqual([{
      id: "first",
      productId: "bundle",
      quantity: 1,
      note: "",
      noteOptionIds: ["less-sugar"],
      bundleChoiceIds: ["tea"],
    }, {
      id: "second",
      productId: "bundle",
      quantity: 1,
      note: "",
      noteOptionIds: [],
      bundleChoiceIds: [],
    }]);
  });
});
