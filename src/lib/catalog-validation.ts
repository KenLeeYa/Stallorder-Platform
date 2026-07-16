import { z } from "zod";

export const productInputSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  price: z.number().int().min(0).max(10_000_000),
  sortOrder: z.number().int().min(0).max(10_000),
  isAvailable: z.boolean(),
}).strict();

export const productUpdateSchema = productInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "至少需要一個更新欄位。" },
);

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
}).strict();

export const categoryUpdateSchema = categoryInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "至少需要一個更新欄位。" },
);

const catalogName = z.string().trim().min(1).max(80);
const sortOrder = z.number().int().min(0).max(10_000);
const uuid = z.string().uuid();
const stallIds = z.array(uuid).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: "攤位清單不可重複。" },
);
export const supportedProductLocales = ["en", "ja", "ko", "vi", "th"] as const;
const productTranslations = z.array(z.object({
  locale: z.enum(supportedProductLocales),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
}).strict()).max(supportedProductLocales.length).refine(
  (translations) => new Set(translations.map((translation) => translation.locale)).size === translations.length,
  { message: "商品翻譯語系不可重複。" },
).default([]);

export const sharedCatalogCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("CREATE_CATEGORY"),
    name: catalogName,
    sortOrder,
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_CATEGORY"),
    categoryId: uuid,
    name: catalogName,
    sortOrder,
    isActive: z.boolean(),
  }).strict(),
  z.object({
    operation: z.literal("CREATE_GROUP"),
    categoryId: uuid,
    name: catalogName,
    sortOrder,
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_GROUP"),
    groupId: uuid,
    categoryId: uuid,
    name: catalogName,
    sortOrder,
    isActive: z.boolean(),
  }).strict(),
  z.object({
    operation: z.literal("CREATE_PRODUCT"),
    categoryId: uuid,
    groupId: uuid.nullable(),
    name: catalogName,
    description: z.string().trim().max(500),
    defaultPrice: z.number().int().min(0).max(10_000_000),
    imageUrl: z.string().url().max(2_000).nullable(),
    sortOrder,
    stallIds,
    translations: productTranslations,
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_PRODUCT"),
    productId: uuid,
    categoryId: uuid,
    groupId: uuid.nullable(),
    name: catalogName,
    description: z.string().trim().max(500),
    defaultPrice: z.number().int().min(0).max(10_000_000),
    imageUrl: z.string().url().max(2_000).nullable(),
    sortOrder,
    isActive: z.boolean(),
    translations: productTranslations,
  }).strict(),
  z.object({
    operation: z.literal("DELETE_PRODUCT"),
    productId: uuid,
  }).strict(),
  z.object({
    operation: z.literal("CLONE_PRODUCT"),
    productId: uuid,
  }).strict(),
  z.object({
    operation: z.literal("SET_ASSIGNMENTS"),
    productId: uuid,
    stallIds,
  }).strict(),
]);

export const stallProductSettingsSchema = z.object({
  priceOverride: z.number().int().min(0).max(10_000_000).nullable(),
  isEnabled: z.boolean(),
  isSoldOut: z.boolean(),
  sortOrder,
  availableFrom: z.string().datetime({ offset: true }).nullable().default(null),
  availableUntil: z.string().datetime({ offset: true }).nullable().default(null),
}).strict().refine((value) => (
  !value.availableFrom || !value.availableUntil
  || new Date(value.availableFrom).getTime() < new Date(value.availableUntil).getTime()
), { message: "供應結束時間必須晚於開始時間。", path: ["availableUntil"] });

export const stallProductBulkCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("BULK_SOLD_OUT"),
    productIds: z.array(uuid).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
    isSoldOut: z.boolean(),
  }).strict(),
  z.object({
    operation: z.literal("COPY_FROM_STALL"),
    sourceStallId: uuid,
  }).strict(),
]);
