import Papa from "papaparse";
import { z } from "zod";
import {
  catalogCsvHeaders,
  catalogCsvTranslationColumns,
  type CatalogCsvRowError,
} from "@/lib/catalog-csv-client";

export * from "@/lib/catalog-csv-client";

const catalogCsvRowSchema = z.object({
  id: z.union([z.literal(""), z.string().uuid()]),
  category: z.string().trim().min(1).max(80),
  group: z.string().trim().max(80),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  price: z.string().regex(/^\d{1,8}$/).transform(Number),
  imageUrl: z.union([z.literal(""), z.string().url().max(2_000)]),
  sortOrder: z.string().regex(/^\d{1,5}$/).transform(Number),
  isActive: z.string().trim().toLowerCase().pipe(z.enum(["true", "false"])).transform((value) => value === "true"),
  stallCodes: z.string().trim().max(2_000).transform((value) => value ? value.split(";").map((code) => code.trim()).filter(Boolean) : []),
  name_en: z.string().trim().max(80),
  description_en: z.string().trim().max(500),
  name_ja: z.string().trim().max(80),
  description_ja: z.string().trim().max(500),
  name_ko: z.string().trim().max(80),
  description_ko: z.string().trim().max(500),
  name_vi: z.string().trim().max(80),
  description_vi: z.string().trim().max(500),
  name_th: z.string().trim().max(80),
  description_th: z.string().trim().max(500),
}).strict().superRefine((row, context) => {
  for (const columns of catalogCsvTranslationColumns) {
    if (!row[columns.name] && row[columns.description]) {
      context.addIssue({
        code: "custom",
        path: [columns.name],
        message: `${columns.locale} 翻譯需填寫商品名稱。`,
      });
    }
  }
});

export type CatalogCsvRow = z.infer<typeof catalogCsvRowSchema>;

export function getCatalogCsvTranslations(row: CatalogCsvRow) {
  return catalogCsvTranslationColumns.map((columns) => ({
    locale: columns.locale,
    name: row[columns.name],
    description: row[columns.description],
  }));
}

export function parseCatalogCsv(text: string) {
  const preview = parseCatalogCsvPreview(text);
  if (!preview.ok) return preview;
  if (preview.errors.length > 0) {
    return { ok: false as const, error: preview.errors[0].error };
  }
  return { ok: true as const, rows: preview.rows.map((item) => item.row) };
}

export function parseCatalogCsvPreview(text: string) {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length > 0) {
    return { ok: false as const, error: `CSV 第 ${(parsed.errors[0].row ?? 0) + 2} 列格式錯誤。` };
  }
  if (parsed.data.length === 0) return { ok: false as const, error: "CSV 沒有商品資料。" };
  if (parsed.data.length > 500) return { ok: false as const, error: "單次最多匯入 500 筆商品。" };

  const headers = parsed.meta.fields ?? [];
  if (catalogCsvHeaders.some((header) => !headers.includes(header))) {
    return { ok: false as const, error: "CSV 欄位不完整，請先匯出範本後再修改。" };
  }

  const rows: Array<{ line: number; row: CatalogCsvRow; values: Record<string, string> }> = [];
  const errors: CatalogCsvRowError[] = [];
  for (const [index, raw] of parsed.data.entries()) {
    const normalized = Object.fromEntries(catalogCsvHeaders.map((header) => [header, raw[header] ?? ""]));
    const row = catalogCsvRowSchema.safeParse(normalized);
    if (!row.success) {
      errors.push({ line: index + 2, error: `CSV 第 ${index + 2} 列資料不正確：${row.error.issues[0]?.message ?? "欄位格式錯誤"}`, values: normalized });
      continue;
    }
    if (new Set(row.data.stallCodes).size !== row.data.stallCodes.length) {
      errors.push({ line: index + 2, error: `CSV 第 ${index + 2} 列有重複攤位代碼。`, values: normalized });
      continue;
    }
    rows.push({ line: index + 2, row: row.data, values: normalized });
  }
  return { ok: true as const, rows, errors, totalRows: parsed.data.length };
}
