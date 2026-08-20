import { z } from "zod";
import {
  PUBLIC_IDENTIFIER_MAX_LENGTH,
  PUBLIC_IDENTIFIER_MIN_LENGTH,
  PUBLIC_IDENTIFIER_REGEX,
} from "./public-identifier";
import {
  multilineText,
  optionalPhoneNumberSchema,
  singleLineText,
} from "./input-validation";

const timezoneSchema = z.string().trim().min(1).max(64).refine((value) => {
  try {
    new Intl.DateTimeFormat("zh-TW", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "請選擇有效的時區。");

const stallFields = {
  name: singleLineText({ minimum: 2, maximum: 80, requiredMessage: "攤位名稱至少需要 2 個字元。" }),
  code: z.string().trim()
    .min(2, "攤位代碼至少需要 2 個字元。")
    .max(PUBLIC_IDENTIFIER_MAX_LENGTH, "攤位代碼不可超過 50 個字元。")
    .regex(/^[A-Za-z0-9-]+$/, "攤位代碼僅可使用英文字母、數字與連字號。")
    .transform((value) => value.toUpperCase()),
  description: multilineText({ maximum: 500 }),
  address: singleLineText({ minimum: 2, maximum: 200, requiredMessage: "地址至少需要 2 個字元。" }),
  phone: optionalPhoneNumberSchema,
  timezone: timezoneSchema,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "幣別必須是 3 碼英文字母代碼。").transform((value) => value.toUpperCase()),
};

export const createStallSchema = z.object({
  ...stallFields,
  slug: z
    .string()
    .trim()
    .min(PUBLIC_IDENTIFIER_MIN_LENGTH, "公開識別名稱至少需要 3 個字元。")
    .max(PUBLIC_IDENTIFIER_MAX_LENGTH, "公開識別名稱不可超過 50 個字元。")
    .regex(PUBLIC_IDENTIFIER_REGEX, "公開識別名稱只能使用小寫英文字母、數字與連字號，且首尾必須是英文字母或數字。"),
}).strict();

const updateStallOperationsSchema = z.object({
  operation: z.literal("UPDATE_OPERATIONS"),
  businessStatus: z.enum(["OPEN", "PAUSED", "CLOSED", "SOLD_OUT"]),
  orderingEnabled: z.boolean(),
  isActive: z.boolean(),
  confirmation: z.literal("DEACTIVATE").optional(),
}).strict().superRefine((value, context) => {
  if (!value.isActive && value.confirmation !== "DEACTIVATE") {
    context.addIssue({ code: "custom", path: ["confirmation"], message: "停用攤位前必須再次確認" });
  }
});

export const updateStallSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("UPDATE_BASIC"), ...stallFields }).strict(),
  updateStallOperationsSchema,
]);

export const stallFieldLabels = {
  name: "攤位名稱",
  code: "攤位代碼",
  slug: "公開識別名稱",
  description: "說明",
  address: "地址",
  phone: "電話",
  timezone: "時區",
  currency: "幣別",
  businessStatus: "營業狀態",
  orderingEnabled: "允許顧客點餐",
  isActive: "啟用此攤位",
  confirmation: "停用確認",
} as const;

export type StallField = keyof typeof stallFieldLabels;

export function getStallFieldErrors(error: z.ZodError) {
  const fieldErrors: Partial<Record<StallField, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path.find((segment): segment is StallField => (
      typeof segment === "string" && Object.prototype.hasOwnProperty.call(stallFieldLabels, segment)
    ));
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = field === "phone"
        ? "電話需為 6～30 個字元，僅可包含數字、空格、括號、連字號與開頭的 +，或留空不填。"
        : /[\u3400-\u9fff]/u.test(issue.message)
        ? issue.message
        : `「${stallFieldLabels[field]}」的格式或內容不符合輸入要求。`;
    }
  }
  return fieldErrors;
}

export function getCreateStallConflictFieldErrors(target: unknown) {
  const fields = Array.isArray(target) ? target.map((field) => String(field).toLowerCase()) : [];
  const constraint = typeof target === "string" ? target.toLowerCase() : "";
  const codeConflict = (
    fields.length === 2
    && fields.includes("code")
    && fields.some((field) => ["organization_id", "organizationid"].includes(field))
  ) || [
    "stalls_organization_code_key",
    "stalls_organization_id_code_key",
    "stalls_code_lower_guard",
    "stalls_code_lower_unique_idx",
  ].includes(constraint);
  const slugConflict = (
    fields.length === 1 && fields[0] === "slug"
  ) || constraint === "stalls_slug_key";
  if (codeConflict && !slugConflict) {
    return { code: "此攤位代碼已被使用，請改用其他代碼。" };
  }
  if (slugConflict && !codeConflict) {
    return { slug: "此公開識別名稱已被使用，請改用其他名稱。" };
  }
  return {
    code: "攤位代碼或公開識別名稱已被使用，請改用其他值。",
    slug: "攤位代碼或公開識別名稱已被使用，請改用其他值。",
  };
}
