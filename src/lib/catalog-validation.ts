import { z } from "zod";
import { multilineText, singleLineText } from "./input-validation";
import { productKinds } from "./product-bundle-types";

export const productInputSchema = z.object({
  categoryId: z.string().uuid(),
  name: singleLineText({ minimum: 1, maximum: 80 }),
  description: multilineText({ maximum: 500 }),
  price: z.number().int().min(0).max(10_000_000),
  sortOrder: z.number().int().min(0).max(10_000),
  isAvailable: z.boolean(),
}).strict();

export const productUpdateSchema = productInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "至少需要一個更新欄位。" },
);

export const categoryInputSchema = z.object({
  name: singleLineText({ minimum: 1, maximum: 50 }),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
}).strict();

export const categoryUpdateSchema = categoryInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "至少需要一個更新欄位。" },
);

const catalogName = singleLineText({ minimum: 1, maximum: 80 });
const sortOrder = z.number().int().min(0).max(10_000);
const uuid = z.string().uuid();
const productKind = z.enum(productKinds);
const bundleQuantity = z.number().int().min(1).max(99);
const bundlePriceDelta = z.number().int().min(-10_000_000).max(10_000_000);
const bundleMinSelections = z.number().int().min(0).max(20);
const bundleMaxSelections = z.number().int().min(1).max(20);
const stallIds = z.array(uuid).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: "攤位清單不可重複。" },
);
const orderedIds = z.array(uuid).min(1).max(500).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: "排序清單不可包含重複項目。" },
);
export const supportedProductLocales = ["en", "ja", "ko", "vi", "th"] as const;
const productTranslations = z.array(z.object({
  locale: z.enum(supportedProductLocales),
  name: singleLineText({ minimum: 1, maximum: 120 }),
  description: multilineText({ maximum: 500 }),
}).strict()).max(supportedProductLocales.length).refine(
  (translations) => new Set(translations.map((translation) => translation.locale)).size === translations.length,
  { message: "商品翻譯語系不可重複。" },
).default([]);
const taxonomyTranslations = z.array(z.object({
  locale: z.enum(supportedProductLocales),
  name: singleLineText({ minimum: 1, maximum: 120 }),
}).strict()).max(supportedProductLocales.length).refine(
  (translations) => new Set(translations.map((translation) => translation.locale)).size === translations.length,
  { message: "分類或群組翻譯語系不可重複。" },
);

export const sharedCatalogCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("CREATE_CATEGORY"),
    name: catalogName,
    sortOrder,
    translations: taxonomyTranslations.default([]),
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_CATEGORY"),
    categoryId: uuid,
    name: catalogName,
    sortOrder,
    isActive: z.boolean(),
    translations: taxonomyTranslations.optional(),
  }).strict(),
  z.object({
    operation: z.literal("CREATE_GROUP"),
    categoryId: uuid,
    name: catalogName,
    sortOrder,
    translations: taxonomyTranslations.default([]),
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_GROUP"),
    groupId: uuid,
    categoryId: uuid,
    name: catalogName,
    sortOrder,
    isActive: z.boolean(),
    translations: taxonomyTranslations.optional(),
  }).strict(),
  z.object({
    operation: z.literal("CREATE_PRODUCT"),
    categoryId: uuid,
    groupId: uuid.nullable(),
    name: catalogName,
    description: multilineText({ maximum: 500 }),
    defaultPrice: z.number().int().min(0).max(10_000_000),
    kind: productKind.default("SINGLE"),
    imageUrl: z.string().url().max(2_000).nullable(),
    isOrderDiscountEligible: z.boolean().default(true),
    isLotteryEligible: z.boolean().default(true),
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
    description: multilineText({ maximum: 500 }),
    defaultPrice: z.number().int().min(0).max(10_000_000),
    kind: productKind.optional(),
    imageUrl: z.string().url().max(2_000).nullable(),
    isOrderDiscountEligible: z.boolean().optional(),
    isLotteryEligible: z.boolean().optional(),
    sortOrder,
    isSoldOut: z.boolean(),
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
  z.object({
    operation: z.literal("REORDER_CATEGORIES"),
    categoryIds: orderedIds,
  }).strict(),
  z.object({
    operation: z.literal("REORDER_GROUPS"),
    categoryId: uuid,
    groupIds: orderedIds,
  }).strict(),
  z.object({
    operation: z.literal("REORDER_PRODUCTS"),
    categoryId: uuid,
    groupId: uuid.nullable(),
    productIds: orderedIds,
  }).strict(),
  z.object({
    operation: z.literal("CREATE_BUNDLE_CHOICE_GROUP"),
    bundleProductId: uuid,
    name: catalogName,
    minSelections: bundleMinSelections,
    maxSelections: bundleMaxSelections,
    sortOrder,
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_BUNDLE_CHOICE_GROUP"),
    choiceGroupId: uuid,
    name: catalogName,
    minSelections: bundleMinSelections,
    maxSelections: bundleMaxSelections,
    sortOrder,
  }).strict(),
  z.object({
    operation: z.literal("DELETE_BUNDLE_CHOICE_GROUP"),
    choiceGroupId: uuid,
  }).strict(),
  z.object({
    operation: z.literal("CREATE_BUNDLE_CHOICE"),
    choiceGroupId: uuid,
    componentProductId: uuid,
    quantity: bundleQuantity,
    priceDelta: bundlePriceDelta,
    isEnabled: z.boolean(),
    sortOrder,
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_BUNDLE_CHOICE"),
    choiceId: uuid,
    choiceGroupId: uuid,
    componentProductId: uuid,
    quantity: bundleQuantity,
    priceDelta: bundlePriceDelta,
    isEnabled: z.boolean(),
    sortOrder,
  }).strict(),
  z.object({
    operation: z.literal("DELETE_BUNDLE_CHOICE"),
    choiceId: uuid,
  }).strict(),
]).superRefine((command, context) => {
  if (
    (command.operation === "CREATE_BUNDLE_CHOICE_GROUP"
      || command.operation === "UPDATE_BUNDLE_CHOICE_GROUP")
    && command.minSelections > command.maxSelections
  ) {
    context.addIssue({
      code: "custom",
      message: "套餐群組最少選擇數不可大於最多選擇數。",
      path: ["maxSelections"],
    });
  }
});

const sharedCatalogFieldLabels: Record<string, string> = {
  name: "名稱",
  categoryId: "商品分類",
  groupId: "商品群組",
  defaultPrice: "預設價格",
  imageUrl: "圖片網址",
  sortOrder: "排序",
  stallIds: "分派攤位",
  minSelections: "最少選擇數",
  maxSelections: "最多選擇數",
  componentProductId: "套餐商品",
  quantity: "數量",
  priceDelta: "加減價",
};

export function getSharedCatalogFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    if (fieldErrors[field]) continue;
    const label = sharedCatalogFieldLabels[field] ?? "欄位";
    fieldErrors[field] = issue.code === "custom"
      ? issue.message
      : `「${label}」輸入不正確，請依欄位限制重新輸入。`;
  }
  return fieldErrors;
}

export const stallProductSettingsSchema = z.object({
  priceOverride: z.number().int().min(0).max(10_000_000).nullable(),
  isEnabled: z.boolean(),
  isSoldOut: z.boolean(),
  sortOrder,
  availableFrom: z.string().datetime({ offset: true }).nullable().default(null),
  availableUntil: z.string().datetime({ offset: true }).nullable().default(null),
  checkoutUpsellSelected: z.boolean(),
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
