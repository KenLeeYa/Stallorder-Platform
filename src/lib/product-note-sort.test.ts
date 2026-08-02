import { describe, expect, it } from "vitest";
import { nextProductNoteSortOrder } from "./product-note-sort";

describe("商品註記排序", () => {
  it("空清單從 1 開始", () => {
    expect(nextProductNoteSortOrder([])).toBe(1);
  });

  it("新項目接在目前最大排序後方，而不是使用筆數", () => {
    expect(nextProductNoteSortOrder([
      { sortOrder: 10 },
      { sortOrder: 30 },
      { sortOrder: 20 },
    ])).toBe(31);
  });
});
