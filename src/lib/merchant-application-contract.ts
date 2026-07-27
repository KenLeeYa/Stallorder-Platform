import { z } from "zod";
import {
  PUBLIC_IDENTIFIER_MAX_LENGTH,
  PUBLIC_IDENTIFIER_MIN_LENGTH,
  PUBLIC_IDENTIFIER_REGEX,
} from "./public-identifier";
import {
  multilineText,
  phoneNumberSchema,
  singleLineText,
} from "./input-validation";
import { isTaiwanCity } from "./taiwan-address";

const nullableText = (maxLength: number) => multilineText({ maximum: maxLength }).nullable();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const merchantBusinessTypes = [
  "NIGHT_MARKET_STALL",
  "FOOD_TRUCK",
  "MARKET_STALL",
  "POPUP_STORE",
  "SMALL_RESTAURANT",
  "BEVERAGE_SHOP",
  "OTHER",
] as const;

export const preferredContactMethods = ["PHONE", "LINE", "EMAIL"] as const;

export const merchantApplicationFieldsSchema = z.object({
  phone: phoneNumberSchema,
  lineId: singleLineText({ maximum: 80 }).nullable(),
  preferredContactMethod: z.enum(preferredContactMethods),
  merchantName: singleLineText({
    minimum: 2,
    maximum: 120,
    requiredMessage: "商家或品牌名稱至少需要 2 個字元。",
  }),
  businessType: z.enum(merchantBusinessTypes),
  businessRegistrationNumber: singleLineText({ maximum: 30 }).nullable(),
  contactName: singleLineText({
    minimum: 2,
    maximum: 80,
    requiredMessage: "負責聯絡人至少需要 2 個字元。",
  }),
  businessPhone: phoneNumberSchema,
  businessAddress: singleLineText({
    minimum: 5,
    maximum: 200,
    requiredMessage: "商家地址至少需要 5 個字元。",
  }),
  city: singleLineText({ minimum: 2, maximum: 40 }).refine(isTaiwanCity, "請選擇有效的縣市。"),
  merchantDescription: nullableText(1000),
  stallName: singleLineText({
    minimum: 2,
    maximum: 120,
    requiredMessage: "第一個攤位名稱至少需要 2 個字元。",
  }),
  stallLocation: singleLineText({
    minimum: 2,
    maximum: 200,
    requiredMessage: "主要營業地點至少需要 2 個字元。",
  }),
  requestedSlug: z
    .string()
    .trim()
    .min(PUBLIC_IDENTIFIER_MIN_LENGTH, "公開識別名稱至少需要 3 個字元。")
    .max(PUBLIC_IDENTIFIER_MAX_LENGTH, "公開識別名稱不可超過 50 個字元。")
    .regex(PUBLIC_IDENTIFIER_REGEX, "公開識別名稱只能使用小寫英文字母、數字與連字號，且首尾必須是英文字母或數字。"),
  estimatedDailyOrders: z.number().int().min(0).max(100_000).nullable(),
  expectedStartDate: dateString,
  needsMultipleStaff: z.boolean(),
  needsKitchenView: z.boolean(),
  requestedPlanCode: z.string().trim().min(2).max(40).regex(/^[A-Z][A-Z0-9_]*$/),
  termsAccepted: z.boolean(),
  privacyAccepted: z.boolean(),
  dataProcessingAccepted: z.boolean(),
  informationConfirmed: z.boolean(),
}).strict();

const submissionFieldsSchema = merchantApplicationFieldsSchema.extend({
  termsAccepted: z.literal(true, { error: "請同意服務條款。" }),
  privacyAccepted: z.literal(true, { error: "請同意隱私權政策。" }),
  dataProcessingAccepted: z.literal(true, { error: "請同意資料處理告知事項。" }),
  informationConfirmed: z.literal(true, { error: "請確認申請資料正確。" }),
});

export const merchantApplicationCommandSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("SAVE_DRAFT"),
    currentStep: z.number().int().min(1).max(4),
    data: merchantApplicationFieldsSchema.partial(),
  }).strict(),
  z.object({
    intent: z.literal("SUBMIT"),
    currentStep: z.literal(4),
    data: submissionFieldsSchema,
  }).strict(),
  z.object({
    intent: z.literal("WITHDRAW"),
    applicationId: z.string().uuid(),
  }).strict(),
]);

export const merchantApplicationAdminCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ASSIGN_REVIEWER"), reviewerProfileId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("ADD_INTERNAL_NOTE"), internalReviewNote: multilineText({ minimum: 3, maximum: 2000 }) }).strict(),
  z.object({
    action: z.literal("REQUEST_INFO"),
    publicReviewNote: multilineText({ minimum: 3, maximum: 1000 }),
    internalReviewNote: nullableText(2000).optional(),
  }).strict(),
  z.object({
    action: z.literal("APPROVE"),
    internalReviewNote: nullableText(2000).optional(),
  }).strict(),
  z.object({
    action: z.literal("REJECT"),
    publicReviewNote: multilineText({ minimum: 3, maximum: 1000 }),
    internalReviewNote: nullableText(2000).optional(),
    reapplicationAllowed: z.boolean().default(false),
  }).strict(),
  z.object({ action: z.literal("ALLOW_REAPPLICATION") }).strict(),
  z.object({
    action: z.literal("MARK_RISK"),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "BLOCKED"]),
    reason: multilineText({ minimum: 3, maximum: 500 }),
  }).strict(),
  z.object({
    action: z.literal("BLOCK_SOURCE"),
    reason: multilineText({ minimum: 3, maximum: 500 }),
  }).strict(),
  z.object({
    action: z.literal("WITHDRAW"),
    internalReviewNote: nullableText(2000).optional(),
  }).strict(),
]);

export type MerchantApplicationFields = z.infer<typeof merchantApplicationFieldsSchema>;
export type MerchantApplicationCommand = z.infer<typeof merchantApplicationCommandSchema>;
export type MerchantApplicationAdminCommand = z.infer<typeof merchantApplicationAdminCommandSchema>;

export const merchantApplicationFieldLabels: Record<keyof MerchantApplicationFields, string> = {
  phone: "聯絡電話",
  lineId: "LINE ID",
  preferredContactMethod: "偏好聯絡方式",
  merchantName: "商家或品牌名稱",
  businessType: "營業類型",
  businessRegistrationNumber: "統一編號",
  contactName: "負責聯絡人",
  businessPhone: "商家電話",
  businessAddress: "商家地址",
  city: "縣市",
  merchantDescription: "商家簡介",
  stallName: "第一個攤位名稱",
  stallLocation: "主要營業地點",
  requestedSlug: "公開識別名稱",
  estimatedDailyOrders: "預估每日訂單",
  expectedStartDate: "預計開始日期",
  needsMultipleStaff: "需要多位員工",
  needsKitchenView: "需要廚房畫面",
  requestedPlanCode: "申請方案",
  termsAccepted: "服務條款",
  privacyAccepted: "隱私權政策",
  dataProcessingAccepted: "資料處理告知事項",
  informationConfirmed: "申請資料確認",
};

export function getMerchantApplicationFieldErrors(error: z.ZodError) {
  const fieldErrors: Partial<Record<keyof MerchantApplicationFields, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path.find((segment): segment is keyof MerchantApplicationFields => (
      typeof segment === "string"
      && Object.prototype.hasOwnProperty.call(merchantApplicationFieldLabels, segment)
    ));
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = /[\u3400-\u9fff]/u.test(issue.message)
        ? issue.message
        : `「${merchantApplicationFieldLabels[field]}」的格式或內容不符合輸入要求。`;
    }
  }
  return fieldErrors;
}

export const merchantApplicationStatusLabels = {
  DRAFT: "草稿",
  SUBMITTED: "已送出",
  PENDING_REVIEW: "等待審核",
  NEEDS_INFO: "需要補件",
  APPROVED: "已核准",
  REJECTED: "未核准",
  WITHDRAWN: "已撤回",
  EXPIRED: "已逾期",
} as const;

export const merchantBusinessTypeLabels = {
  NIGHT_MARKET_STALL: "夜市攤位",
  FOOD_TRUCK: "餐車",
  MARKET_STALL: "市集攤位",
  POPUP_STORE: "快閃店",
  SMALL_RESTAURANT: "小型餐飲店",
  BEVERAGE_SHOP: "飲料店",
  OTHER: "其他",
} as const;
