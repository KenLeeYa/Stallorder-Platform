import { z } from "zod";
import { supportedProductLocales } from "@/lib/catalog-validation";
import { singleLineText } from "@/lib/input-validation";

const transferName = singleLineText({ minimum: 1, maximum: 80 });
export const productNoteTransferMaxBytes = 1_000_000;
export const productNoteTransferMaxOptions = 1_000;
export const productNoteTransferMaxAssignments = 1_000;
const translationSchema = z.object({
  locale: z.enum(supportedProductLocales),
  name: singleLineText({ minimum: 1, maximum: 120 }),
}).strict();
const translationsSchema = z.array(translationSchema)
  .max(supportedProductLocales.length)
  .refine((items) => new Set(items.map((item) => item.locale)).size === items.length, {
    message: "同一筆資料的翻譯語系不可重複。",
  });
const sortOrderSchema = z.number().int().min(0).max(10_000);
const productReferenceSchema = z.object({
  id: z.string().uuid().nullable(),
  name: transferName,
  sortOrder: sortOrderSchema,
}).strict();
const reusableNoteSchema = z.object({
  name: transferName,
  priceDelta: z.number().int().min(-10_000_000).max(10_000_000),
  sortOrder: sortOrderSchema,
  isActive: z.boolean(),
  translations: translationsSchema,
}).strict();
const optionSchema = z.object({
  name: transferName,
  reusableNoteName: transferName.nullable(),
  priceDelta: z.number().int().min(-10_000_000).max(10_000_000),
  sortOrder: sortOrderSchema,
  isActive: z.boolean(),
  translations: translationsSchema,
}).strict();
const groupSchema = z.object({
  name: transferName,
  selectionMode: z.enum(["SINGLE", "MULTIPLE"]),
  isRequired: z.boolean(),
  minSelections: z.number().int().min(0).max(20),
  maxSelections: z.number().int().min(1).max(20).nullable(),
  sortOrder: sortOrderSchema,
  isActive: z.boolean(),
  translations: translationsSchema,
  products: z.array(productReferenceSchema).max(100),
  options: z.array(optionSchema).max(200),
}).strict().superRefine((group, context) => {
  if (group.selectionMode === "SINGLE" && group.maxSelections !== 1) {
    context.addIssue({ code: "custom", path: ["maxSelections"], message: "單選群組上限必須為 1。" });
  }
  if (group.isRequired && group.minSelections < 1) {
    context.addIssue({ code: "custom", path: ["minSelections"], message: "必選群組至少需選 1 項。" });
  }
  if (group.maxSelections !== null && group.minSelections > group.maxSelections) {
    context.addIssue({ code: "custom", path: ["maxSelections"], message: "最多選取數不可小於最少選取數。" });
  }
  addDuplicateNameIssue(group.options, context, ["options"], "同一群組的註記名稱不可重複。");
  addDuplicateProductIssue(group.products, context);
});

export const productNoteTransferSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  sourceCurrency: z.string().regex(/^[A-Z]{3}$/u, "來源幣別必須是三碼大寫代碼。"),
  reusableNotes: z.array(reusableNoteSchema).max(500),
  groups: z.array(groupSchema).max(200),
}).strict().superRefine((transfer, context) => {
  addDuplicateNameIssue(transfer.reusableNotes, context, ["reusableNotes"], "共用單一註記名稱不可重複。");
  addDuplicateNameIssue(transfer.groups, context, ["groups"], "註記群組名稱不可重複。");
  const reusableNotes = new Map(transfer.reusableNotes.map((note) => [normalizedName(note.name), note]));
  for (const [groupIndex, group] of transfer.groups.entries()) {
    for (const [optionIndex, option] of group.options.entries()) {
      if (option.reusableNoteName && !reusableNotes.has(normalizedName(option.reusableNoteName))) {
        context.addIssue({
          code: "custom",
          path: ["groups", groupIndex, "options", optionIndex, "reusableNoteName"],
          message: `共用單一註記「${option.reusableNoteName}」不在匯入檔中。`,
        });
      } else if (
        option.reusableNoteName
        && normalizedName(option.name) !== normalizedName(option.reusableNoteName)
      ) {
        context.addIssue({
          code: "custom",
          path: ["groups", groupIndex, "options", optionIndex, "name"],
          message: "共用註記在群組中的名稱必須與單一註記一致。",
        });
      }
    }
  }
  const optionCount = transfer.groups.reduce((total, group) => total + group.options.length, 0);
  if (optionCount > productNoteTransferMaxOptions) {
    context.addIssue({
      code: "custom",
      path: ["groups"],
      message: `單次最多可包含 ${productNoteTransferMaxOptions.toLocaleString("en-US")} 個群組註記。`,
    });
  }
  const assignmentCount = transfer.groups.reduce((total, group) => total + group.products.length, 0);
  if (assignmentCount > productNoteTransferMaxAssignments) {
    context.addIssue({
      code: "custom",
      path: ["groups"],
      message: `單次最多可包含 ${productNoteTransferMaxAssignments.toLocaleString("en-US")} 個商品指派。`,
    });
  }
});

export type ProductNoteTransfer = z.infer<typeof productNoteTransferSchema>;

export function parseProductNoteTransfer(text: string) {
  if (utf8ByteLength(text) > productNoteTransferMaxBytes) {
    return { ok: false as const, error: "註記匯入檔不可超過 1MB。" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    return { ok: false as const, error: "註記匯入檔不是有效的 JSON。" };
  }
  const parsed = productNoteTransferSchema.safeParse(value);
  if (!parsed.success) {
    return transferSchemaError(parsed.error);
  }
  return { ok: true as const, transfer: parsed.data };
}

export function serializeProductNoteTransfer(value: unknown) {
  const parsed = productNoteTransferSchema.safeParse(value);
  if (!parsed.success) return transferSchemaError(parsed.error, "註記匯出資料格式不正確。");
  const text = `${JSON.stringify(parsed.data, null, 2)}\n`;
  if (utf8ByteLength(text) > productNoteTransferMaxBytes) {
    return {
      ok: false as const,
      error: "註記資料超過 1MB 匯出上限，請精簡註記後再匯出。",
    };
  }
  return { ok: true as const, text, transfer: parsed.data };
}

export function productNoteTransferFileName(now = new Date()) {
  return `stallorder-product-notes-${now.toISOString().slice(0, 10)}.json`;
}

export function normalizedName(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("zh-TW");
}

function addDuplicateNameIssue(
  values: Array<{ name: string }>,
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
) {
  const names = new Set<string>();
  for (const [index, value] of values.entries()) {
    const key = normalizedName(value.name);
    if (names.has(key)) {
      context.addIssue({ code: "custom", path: [...path, index, "name"], message });
      return;
    }
    names.add(key);
  }
}

function addDuplicateProductIssue(
  products: Array<{ id: string | null; name: string }>,
  context: z.RefinementCtx,
) {
  const references = new Set<string>();
  for (const [index, product] of products.entries()) {
    const key = product.id ?? `name:${normalizedName(product.name)}`;
    if (references.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["products", index],
        message: "同一註記群組不可重複指派商品。",
      });
      return;
    }
    references.add(key);
  }
}

function formatTransferIssuePath(path: PropertyKey[]) {
  const parts: string[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const next = path[index + 1];
    if (segment === "reusableNotes" && typeof next === "number") {
      parts.push(`共用註記第 ${next + 1} 筆`);
      index += 1;
    } else if (segment === "groups" && typeof next === "number") {
      parts.push(`註記群組第 ${next + 1} 筆`);
      index += 1;
    } else if (segment === "options" && typeof next === "number") {
      parts.push(`群組註記第 ${next + 1} 筆`);
      index += 1;
    } else if (segment === "products" && typeof next === "number") {
      parts.push(`商品指派第 ${next + 1} 筆`);
      index += 1;
    } else if (segment === "translations" && typeof next === "number") {
      parts.push(`翻譯第 ${next + 1} 筆`);
      index += 1;
    } else if (typeof segment === "string") {
      parts.push(transferFieldLabel(segment));
    }
  }
  return parts.join(" > ");
}

function transferFieldLabel(field: string) {
  return ({
    name: "名稱",
    reusableNoteName: "共用註記名稱",
    priceDelta: "加減價",
    sortOrder: "排序",
    isActive: "啟用狀態",
    selectionMode: "選取模式",
    isRequired: "必選設定",
    minSelections: "最少選取數",
    maxSelections: "最多選取數",
    reusableNotes: "共用註記",
    groups: "註記群組",
    products: "商品指派",
    options: "群組註記",
    locale: "語系",
    id: "商品識別碼",
    sourceCurrency: "來源幣別",
  } as Record<string, string>)[field] ?? field;
}

function transferSchemaError(error: z.ZodError, fallback = "註記匯入資料格式不正確。") {
  const issue = error.issues[0];
  const location = issue ? formatTransferIssuePath(issue.path) : "";
  return {
    ok: false as const,
    error: issue
      ? `${location ? `${location}：` : ""}${issue.message}`
      : fallback,
  };
}

function utf8ByteLength(text: string) {
  return new TextEncoder().encode(text).byteLength;
}
