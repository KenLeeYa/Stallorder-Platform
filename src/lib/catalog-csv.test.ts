import { describe, expect, it } from "vitest";
import { buildCatalogCsvErrorReport, catalogCsvHeaders, parseCatalogCsv, parseCatalogCsvPreview } from "./catalog-csv";

const headers = catalogCsvHeaders.join(",");
const blankTranslations = ",,,,,,,,,,";

describe("商品 CSV 匯入", () => {
  it("接受由匯出功能產生的商品資料", () => {
    const parsed = parseCatalogCsv(`${headers}\n,炸物,人氣炸物,香酥雞排,現炸,95,https://example.com/chicken.webp,1,true,AMING-01${blankTranslations}`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.rows[0].stallCodes).toEqual(["AMING-01"]);
  });

  it("拒絕缺少欄位與試算表公式型價格", () => {
    expect(parseCatalogCsv("name,price\n雞排,95").ok).toBe(false);
    expect(parseCatalogCsv(`${headers}\n,炸物,,雞排,現炸,=100,,1,true,AMING-01${blankTranslations}`).ok).toBe(false);
  });

  it("接受完整翻譯並拒絕只有說明的翻譯", () => {
    expect(parseCatalogCsv(`${headers}\n,炸物,,雞排,現炸,95,,1,true,AMING-01,Chicken,Fried chicken,,,,,,,,`).ok).toBe(true);
    expect(parseCatalogCsv(`${headers}\n,炸物,,雞排,現炸,95,,1,true,AMING-01,,Fried chicken,,,,,,,,`).ok).toBe(false);
  });

  it("預覽會保留有效列並產生可下載的錯誤列", () => {
    const preview = parseCatalogCsvPreview(`${headers}\n,炸物,,雞排,現炸,95,,1,true,AMING-01${blankTranslations}\n,炸物,,錯誤商品,,=100,,2,true,AMING-01${blankTranslations}`);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.rows).toHaveLength(1);
    expect(preview.errors).toHaveLength(1);
    expect(buildCatalogCsvErrorReport(preview.errors)).toContain("錯誤商品");
  });
});
