import Papa from "papaparse";

export const catalogCsvHeaders = [
  "id",
  "category",
  "group",
  "name",
  "description",
  "price",
  "imageUrl",
  "sortOrder",
  "isActive",
  "stallCodes",
  "name_en",
  "description_en",
  "name_ja",
  "description_ja",
  "name_ko",
  "description_ko",
  "name_vi",
  "description_vi",
  "name_th",
  "description_th",
  "isOrderDiscountEligible",
  "isLotteryEligible",
] as const;

export const catalogCsvTranslationColumns = [
  { locale: "en", name: "name_en", description: "description_en" },
  { locale: "ja", name: "name_ja", description: "description_ja" },
  { locale: "ko", name: "name_ko", description: "description_ko" },
  { locale: "vi", name: "name_vi", description: "description_vi" },
  { locale: "th", name: "name_th", description: "description_th" },
] as const;

export type CatalogCsvRowError = {
  line: number;
  error: string;
  values: Record<string, string>;
};

export function buildCatalogCsvErrorReport(errors: CatalogCsvRowError[]) {
  return Papa.unparse(errors.map((error) => ({
    line: error.line,
    error: error.error,
    ...Object.fromEntries(catalogCsvHeaders.map((header) => [header, error.values[header] ?? ""])),
  })), { columns: ["line", "error", ...catalogCsvHeaders] });
}
