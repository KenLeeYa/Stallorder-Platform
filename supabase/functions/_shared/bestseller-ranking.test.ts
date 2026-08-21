import { describe, expect, it } from "vitest";
import { applyBestSellerRanking } from "./bestseller-ranking";

describe("best-seller menu ranking", () => {
  it("promotes ranked products only within their existing category", () => {
    const products = [
      { id: "meal-regular", category: "主餐", name: "一般主餐" },
      { id: "meal-best", category: "主餐", name: "熱銷主餐" },
      { id: "drink-regular", category: "飲品", name: "一般飲品" },
      { id: "drink-best", category: "飲品", name: "熱銷飲品" },
    ];

    const ranked = applyBestSellerRanking(products, [
      { product_id: "drink-best", rank: 1 },
      { product_id: "meal-best", rank: 2 },
    ]);

    expect(ranked.map((product) => product.id)).toEqual([
      "meal-best",
      "meal-regular",
      "drink-best",
      "drink-regular",
    ]);
    expect(ranked.map(({ id, rank, isBestSeller }) => ({ id, rank, isBestSeller }))).toEqual([
      { id: "meal-best", rank: 2, isBestSeller: true },
      { id: "meal-regular", rank: null, isBestSeller: false },
      { id: "drink-best", rank: 1, isBestSeller: true },
      { id: "drink-regular", rank: null, isBestSeller: false },
    ]);
  });

  it("ignores malformed or out-of-contract ranks", () => {
    const [product] = applyBestSellerRanking(
      [{ id: "product", category: "主餐" }],
      [{ product_id: "product", rank: 4 }],
    );

    expect(product).toMatchObject({ rank: null, isBestSeller: false });
  });

  it("keeps catalog groups together while promoting best sellers inside each group", () => {
    const ranked = applyBestSellerRanking([
      { id: "hot-regular", category: "主餐", group: "熱食" },
      { id: "hot-best", category: "主餐", group: "熱食" },
      { id: "cold-best", category: "主餐", group: "冷食" },
    ], [
      { product_id: "cold-best", rank: 1 },
      { product_id: "hot-best", rank: 2 },
    ]);

    expect(ranked.map((product) => product.id)).toEqual([
      "hot-best",
      "hot-regular",
      "cold-best",
    ]);
  });
});
