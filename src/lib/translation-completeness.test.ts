import { describe, expect, it } from "vitest";
import { calculateTranslationCoverage } from "./translation-completeness";

describe("calculateTranslationCoverage", () => {
  const products = [{
    id: "product-1",
    name: "雞排",
    description: "現炸",
    isActive: true,
    translations: [{ locale: "en", name: "Chicken", description: "Freshly fried" }],
  }, {
    id: "product-2",
    name: "紅茶",
    description: "",
    isActive: true,
    translations: [],
  }];
  const groups = [{
    id: "group-1",
    name: "加料",
    isActive: true,
    translations: [{ locale: "en", name: "Extras" }],
    options: [{ id: "option-1", name: "加蛋", isActive: true, translations: [] }],
  }];
  const categories = [{
    id: "category-1",
    name: "主餐",
    isActive: true,
    translations: [{ locale: "en", name: "Mains" }],
  }];
  const productGroups = [{
    id: "product-group-1",
    name: "湯河粉",
    isActive: true,
    translations: [],
  }];

  it("將來源語系視為完整", () => {
    const [coverage] = calculateTranslationCoverage(["zh-TW"], products, groups);
    expect(coverage).toMatchObject({ completed: 5, total: 5, percentage: 100, missing: [] });
  });

  it("列出商品名稱與註記選項缺漏", () => {
    const [coverage] = calculateTranslationCoverage(["en"], products, groups);
    expect(coverage).toMatchObject({ completed: 3, total: 5, percentage: 60 });
    expect(coverage.missing).toEqual([
      { entityType: "PRODUCT", entityId: "product-2", sourceName: "紅茶" },
      { entityType: "NOTE_OPTION", entityId: "option-1", sourceName: "加料 / 加蛋" },
    ]);
  });

  it("將分類與商品群組納入完整性檢查", () => {
    const [coverage] = calculateTranslationCoverage(
      ["en"],
      products,
      groups,
      categories,
      productGroups,
    );

    expect(coverage).toMatchObject({ completed: 4, total: 7, percentage: 57 });
    expect(coverage.missing).toContainEqual({
      entityType: "PRODUCT_GROUP",
      entityId: "product-group-1",
      sourceName: "湯河粉",
    });
  });
});
