import { z } from "zod";

const nullableText = (maxLength: number) => z.string().trim().max(maxLength).nullable();
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
  phone: z.string().trim().min(6).max(30),
  lineId: nullableText(80),
  preferredContactMethod: z.enum(preferredContactMethods),
  merchantName: z.string().trim().min(2).max(120),
  businessType: z.enum(merchantBusinessTypes),
  businessRegistrationNumber: nullableText(30),
  contactName: z.string().trim().min(2).max(80),
  businessPhone: z.string().trim().min(6).max(30),
  businessAddress: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(40),
  merchantDescription: nullableText(1000),
  stallName: z.string().trim().min(2).max(120),
  stallLocation: z.string().trim().min(2).max(200),
  requestedSlug: z.string().trim().min(3).max(50).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
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
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  dataProcessingAccepted: z.literal(true),
  informationConfirmed: z.literal(true),
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
  z.object({ action: z.literal("ADD_INTERNAL_NOTE"), internalReviewNote: z.string().trim().min(3).max(2000) }).strict(),
  z.object({
    action: z.literal("REQUEST_INFO"),
    publicReviewNote: z.string().trim().min(3).max(1000),
    internalReviewNote: nullableText(2000).optional(),
  }).strict(),
  z.object({
    action: z.literal("APPROVE"),
    internalReviewNote: nullableText(2000).optional(),
  }).strict(),
  z.object({
    action: z.literal("REJECT"),
    publicReviewNote: z.string().trim().min(3).max(1000),
    internalReviewNote: nullableText(2000).optional(),
    reapplicationAllowed: z.boolean().default(false),
  }).strict(),
  z.object({ action: z.literal("ALLOW_REAPPLICATION") }).strict(),
  z.object({
    action: z.literal("MARK_RISK"),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "BLOCKED"]),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("BLOCK_SOURCE"),
    reason: z.string().trim().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("WITHDRAW"),
    internalReviewNote: nullableText(2000).optional(),
  }).strict(),
]);

export type MerchantApplicationFields = z.infer<typeof merchantApplicationFieldsSchema>;
export type MerchantApplicationCommand = z.infer<typeof merchantApplicationCommandSchema>;
export type MerchantApplicationAdminCommand = z.infer<typeof merchantApplicationAdminCommandSchema>;

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
