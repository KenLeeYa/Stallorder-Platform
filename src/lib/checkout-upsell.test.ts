import { describe, expect, it } from "vitest";
import { resolveCheckoutUpsellCandidates } from "@/lib/checkout-upsell";
import type { PublicMenuProduct } from "@/lib/public-menu-types";

function product(id: string, overrides: Partial<PublicMenuProduct> = {}): PublicMenuProduct {
  return {
    id,
    name: id,
    description: "",
    price: 100,
    kind: "SINGLE",
    category: "主餐",
    rank: null,
    isBestSeller: false,
    isSoldOut: false,
    isOrderDiscountEligible: true,
    imageUrl: null,
    translations: [],
    noteGroups: [],
    bundleChoiceGroups: [],
    ...overrides,
  };
}

describe("resolveCheckoutUpsellCandidates", () => {
  it("keeps the merchant order and removes sold-out, missing, and already-selected products", () => {
    const products = [
      product("drink"),
      product("dessert", { isSoldOut: true }),
      product("side"),
    ];

    expect(resolveCheckoutUpsellCandidates({
      products,
      configuredProductIds: ["side", "missing", "dessert", "drink"],
      cartProductIds: new Set(["drink"]),
    }).map((candidate) => candidate.id)).toEqual(["side"]);
  });

  it("returns no recommendation when the module is not configured", () => {
    expect(resolveCheckoutUpsellCandidates({
      products: [product("drink")],
      configuredProductIds: [],
      cartProductIds: new Set(),
    })).toEqual([]);
  });
});
