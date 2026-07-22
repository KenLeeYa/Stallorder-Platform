import { z } from "npm:zod@4.2.1";

export const issueOrderSessionSchema = z.object({
  qrToken: z.string().trim().min(24).max(200),
  deviceId: z.string().uuid(),
  orderingMode: z.enum(["DEFAULT", "DELIVERY"]).default("DEFAULT"),
  includeMenu: z.boolean().default(true),
});

export const createPublicOrderSchema = z.object({
  qrToken: z.string().trim().min(24).max(200),
  orderSessionToken: z.string().min(40).max(200),
  deviceId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  customerName: z.string().trim().max(50).optional().default(""),
  customerPhone: z.string().trim().max(30).optional().default(""),
  deliveryAddress: z.string().trim().max(300).optional().default(""),
  customerNote: z.string().trim().max(1000).optional().default(""),
  waitAcknowledged: z.boolean().default(false),
  orderingMode: z.enum(["DEFAULT", "DELIVERY"]).default("DEFAULT"),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
    note: z.string().trim().max(1000).optional().default(""),
    noteOptionIds: z.array(z.string().uuid()).max(50).default([]),
  })).min(1).max(100),
  turnstileToken: z.string().min(1).max(2048),
}).superRefine((value, context) => {
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
});

const trackedOrderIdentitySchema = z.object({
  trackingToken: z.string().min(40).max(200),
  deviceId: z.string().uuid(),
});

export const manageLineLinkSchema = z.discriminatedUnion("action", [
  trackedOrderIdentitySchema.extend({ action: z.literal("STATUS") }).strict(),
  trackedOrderIdentitySchema.extend({ action: z.literal("START") }).strict(),
  trackedOrderIdentitySchema.extend({ action: z.literal("REVOKE") }).strict(),
]);

export const prepareReorderSchema = trackedOrderIdentitySchema.strict();

export type PublicOrderInput = z.infer<typeof createPublicOrderSchema>;
