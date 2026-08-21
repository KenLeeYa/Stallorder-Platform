import { describe, expect, it } from "vitest";
import {
  catalogTranslationBenchmarkCases,
  catalogTranslationBenchmarkLocales,
  type CatalogTranslationBenchmarkRisk,
} from "./fixtures/catalog-translation-benchmark";

describe("catalog translation benchmark fixture", () => {
  it("固定為 50 筆來源、5 個目標語系與 250 個人工審核目標", () => {
    expect(catalogTranslationBenchmarkCases).toHaveLength(50);
    expect(catalogTranslationBenchmarkLocales).toEqual(["en", "ja", "ko", "vi", "th"]);
    expect(catalogTranslationBenchmarkCases.length * catalogTranslationBenchmarkLocales.length).toBe(250);
    expect(new Set(catalogTranslationBenchmarkCases.map((item) => item.id)).size).toBe(50);
  });

  it("包含菜名、品牌、數字、過敏原、宣稱、促銷與提示注入風險", () => {
    const requiredRisks: readonly CatalogTranslationBenchmarkRisk[] = [
      "allergen",
      "cultural-term",
      "dietary-claim",
      "mixed-script",
      "number-or-unit",
      "promotion",
      "protected-token",
      "prompt-injection",
    ];
    const present = new Set(catalogTranslationBenchmarkCases.flatMap((item) => item.risks));
    expect(requiredRisks.every((risk) => present.has(risk))).toBe(true);
    expect(catalogTranslationBenchmarkCases.filter((item) => item.risks.includes("cultural-term")).length)
      .toBeGreaterThanOrEqual(15);
    expect(catalogTranslationBenchmarkCases.filter((item) => item.risks.includes("protected-token")).length)
      .toBeGreaterThanOrEqual(10);
  });

  it("所有欄位符合正式翻譯 contract 的來源長度", () => {
    for (const item of catalogTranslationBenchmarkCases) {
      expect(item.id).toMatch(/^product-\d{2}$/u);
      expect(item.sourceName.trim().length).toBeGreaterThan(0);
      expect(item.sourceName.length).toBeLessThanOrEqual(120);
      expect(item.sourceDescription.trim().length).toBeGreaterThan(0);
      expect(item.sourceDescription.length).toBeLessThanOrEqual(500);
      expect(item.context.trim().length).toBeGreaterThan(0);
    }
  });
});
