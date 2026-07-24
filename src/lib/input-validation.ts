import { z } from "zod";

const SINGLE_LINE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const MULTILINE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const PHONE_NUMBER = /^\+?[0-9][0-9 ().-]*$/;

type TextOptions = {
  minimum?: number;
  maximum: number;
  requiredMessage?: string;
};

export function singleLineText({
  minimum = 0,
  maximum,
  requiredMessage = "此欄位不可空白。",
}: TextOptions) {
  return z.string()
    .trim()
    .min(minimum, minimum > 0 ? requiredMessage : undefined)
    .max(maximum)
    .refine(
      (value) => !SINGLE_LINE_CONTROL_CHARACTERS.test(value),
      "不可包含換行或控制字元。",
    );
}

export function multilineText({
  minimum = 0,
  maximum,
  requiredMessage = "此欄位不可空白。",
}: TextOptions) {
  return z.string()
    .trim()
    .min(minimum, minimum > 0 ? requiredMessage : undefined)
    .max(maximum)
    .refine(
      (value) => !MULTILINE_CONTROL_CHARACTERS.test(value),
      "不可包含控制字元。",
    );
}

export const phoneNumberSchema = z.string()
  .trim()
  .min(6, "電話至少需要 6 個字元。")
  .max(30)
  .regex(PHONE_NUMBER, "電話只能包含數字、空格、括號、連字號與開頭的 +。");

export const optionalPhoneNumberSchema = z.union([
  z.literal(""),
  phoneNumberSchema,
]);
