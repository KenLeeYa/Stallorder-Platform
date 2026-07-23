import { z } from "zod";
import {
  PUBLIC_IDENTIFIER_MAX_LENGTH,
  PUBLIC_IDENTIFIER_MIN_LENGTH,
  PUBLIC_IDENTIFIER_REGEX,
} from "./public-identifier";

const timezoneSchema = z.string().trim().min(1).max(64).refine((value) => {
  try {
    new Intl.DateTimeFormat("zh-TW", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "時區格式不正確");

const stallFields = {
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9-]+$/).transform((value) => value.toUpperCase()),
  description: z.string().trim().max(500),
  address: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(30),
  timezone: timezoneSchema,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
};

export const createStallSchema = z.object({
  ...stallFields,
  slug: z
    .string()
    .trim()
    .min(PUBLIC_IDENTIFIER_MIN_LENGTH)
    .max(PUBLIC_IDENTIFIER_MAX_LENGTH)
    .regex(PUBLIC_IDENTIFIER_REGEX),
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
