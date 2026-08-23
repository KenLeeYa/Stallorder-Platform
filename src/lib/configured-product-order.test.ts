import { describe, expect, it } from "vitest";
import {
  compareConfiguredProductOrder,
  UNGROUPED_PRODUCT_SORT_ORDER,
  type ConfiguredProductOrder,
} from "./configured-product-order";

function item(
  id: string,
  values: Partial<Omit<ConfiguredProductOrder, "id" | "name">> = {},
): ConfiguredProductOrder {
  return {
    id,
    name: id,
    categorySortOrder: 0,
    groupSortOrder: 0,
    productSortOrder: 0,
    stallProductSortOrder: 0,
    ...values,
  };
}

describe("configured product ordering", () => {
  it("uses category, group, stall product, and shared product ordering in that order", () => {
    const products = [
      item("category-second", { categorySortOrder: 1 }),
      item("stall-second", { stallProductSortOrder: 1 }),
      item("product-second", { productSortOrder: 1 }),
      item("group-second", { groupSortOrder: 1 }),
      item("first"),
    ];

    expect(products.sort(compareConfiguredProductOrder).map((product) => product.id)).toEqual([
      "first",
      "product-second",
      "stall-second",
      "group-second",
      "category-second",
    ]);
  });

  it("places ungrouped products after configured groups in the same category", () => {
    const products = [
      item("ungrouped", { groupSortOrder: UNGROUPED_PRODUCT_SORT_ORDER }),
      item("grouped", { groupSortOrder: 3 }),
    ];

    expect(products.sort(compareConfiguredProductOrder).map((product) => product.id)).toEqual([
      "grouped",
      "ungrouped",
    ]);
  });
});
