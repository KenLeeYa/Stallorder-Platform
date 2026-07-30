import { z } from "zod";

const SINGLE_LINE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const MULTILINE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const PHONE_NUMBER = /^\+?[0-9][0-9 ().-]*$/;
const singleLineText = (maximum: number) => z.string().trim().max(maximum).refine(
  (value) => !SINGLE_LINE_CONTROL_CHARACTERS.test(value),
  "invalid single-line text",
);
const multilineText = (maximum: number) => z.string().trim().max(maximum).refine(
  (value) => !MULTILINE_CONTROL_CHARACTERS.test(value),
  "invalid multiline text",
);
const optionalPhone = z.union([
  z.literal(""),
  z.string().trim().min(6).max(30).regex(PHONE_NUMBER),
]);

export const issueOrderSessionSchema = z.object({
  qrToken: z.string().trim().min(24).max(200),
  deviceId: z.string().uuid(),
  sessionRequestId: z.string().uuid().optional(),
  orderingMode: z.enum(["DEFAULT", "DELIVERY"]).default("DEFAULT"),
  includeMenu: z.boolean().default(true),
}).strict();

export const createPublicOrderSchema = z.object({
  qrToken: z.string().trim().min(24).max(200),
  orderSessionToken: z.string().min(40).max(200),
  deviceId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  clientOrderId: z.string().uuid().optional(),
  turnstileIdempotencyKey: z.string().uuid().optional(),
  customerName: singleLineText(50).optional().default(""),
  customerPhone: optionalPhone.optional().default(""),
  deliveryAddress: multilineText(300).optional().default(""),
  customerNote: multilineText(1000).optional().default(""),
  waitAcknowledged: z.boolean().default(false),
  orderingMode: z.enum(["DEFAULT", "DELIVERY"]).default("DEFAULT"),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
    note: multilineText(1000).optional().default(""),
    noteOptionIds: z.array(z.string().uuid()).max(50).default([]),
  })).min(1).max(100),
  turnstileToken: z.string().min(1).max(2048),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.productId)).size !== value.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "duplicate products" });
  }
  value.items.forEach((item, index) => {
    if (new Set(item.noteOptionIds).size !== item.noteOptionIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "noteOptionIds"], message: "duplicate note options" });
    }
  });
  if (value.orderingMode === "DELIVERY") {
    if (value.customerPhone.length < 6) {
      context.addIssue({ code: "custom", path: ["customerPhone"], message: "invalid delivery phone" });
    }
    if (value.deliveryAddress.length < 1) {
      context.addIssue({ code: "custom", path: ["deliveryAddress"], message: "delivery address required" });
    }
  }
});

export const getPublicOrderSchema = z.object({
  trackingToken: z.string().min(40).max(200),
  deviceId: z.string().uuid(),
}).strict();

const trackedOrderIdentitySchema = z.object({
  trackingToken: z.string().min(40).max(200),
  deviceId: z.string().uuid(),
}).strict();

export const manageLineLinkSchema = z.discriminatedUnion("action", [
  trackedOrderIdentitySchema.extend({ action: z.literal("STATUS") }).strict(),
  trackedOrderIdentitySchema.extend({ action: z.literal("START") }).strict(),
  trackedOrderIdentitySchema.extend({ action: z.literal("REVOKE") }).strict(),
]);

export const prepareReorderSchema = trackedOrderIdentitySchema.strict();

export type PublicOrderInput = z.infer<typeof createPublicOrderSchema>;
export type IssueOrderSessionInput = z.infer<typeof issueOrderSessionSchema>;
export type GetPublicOrderInput = z.infer<typeof getPublicOrderSchema>;
