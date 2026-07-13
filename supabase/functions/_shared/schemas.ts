import { z } from "npm:zod@4.2.1";

export const issueOrderSessionSchema = z.object({
  qrToken: z.string().trim().min(24).max(200),
  deviceId: z.string().uuid(),
});

export const createPublicOrderSchema = z.object({
  qrToken: z.string().trim().min(24).max(200),
  orderSessionToken: z.string().min(40).max(200),
  deviceId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  customerName: z.string().trim().max(50).optional().default(""),
  customerNote: z.string().trim().max(1000).optional().default(""),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
    note: z.string().trim().max(1000).optional().default(""),
  })).min(1).max(100),
  turnstileToken: z.string().min(1).max(2048),
}).superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.productId)).size !== value.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "duplicate products" });
  }
});

export const getPublicOrderSchema = z.object({
  trackingToken: z.string().min(40).max(200),
  deviceId: z.string().uuid(),
});

export type PublicOrderInput = z.infer<typeof createPublicOrderSchema>;
