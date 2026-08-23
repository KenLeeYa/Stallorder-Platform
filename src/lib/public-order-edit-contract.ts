import { z } from "zod";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const multilineText = (maximum: number) => z.string().trim().max(maximum);

const publicOrderEditLineSchema = z.object({
  productId: uuid,
  quantity: z.number().int().min(1).max(100),
  note: multilineText(1000).default(""),
  noteOptionIds: z.array(uuid).max(50).default([]),
  bundleChoiceIds: z.array(uuid).max(50).default([]),
}).strict();

export const updateTrackedPublicOrderSchema = z.object({
  deviceId: uuid,
  idempotencyKey: uuid,
  turnstileToken: z.string().min(1).max(2048),
  customerName: z.string().trim().max(50).default(""),
  customerPhone: z.string().trim().max(30).default(""),
  deliveryAddress: multilineText(300).default(""),
  customerNote: multilineText(1000).default(""),
  items: z.array(publicOrderEditLineSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  const configurations = value.items.map((item) => JSON.stringify([
    item.productId,
    item.note,
    [...item.noteOptionIds].sort(),
    [...item.bundleChoiceIds].sort(),
  ]));
  if (new Set(configurations).size !== configurations.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "duplicate item configurations" });
  }
  value.items.forEach((item, index) => {
    if (new Set(item.noteOptionIds).size !== item.noteOptionIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "noteOptionIds"], message: "duplicate note options" });
    }
    if (new Set(item.bundleChoiceIds).size !== item.bundleChoiceIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "bundleChoiceIds"], message: "duplicate bundle choices" });
    }
  });
});

export const cancelTrackedPublicOrderSchema = z.object({
  deviceId: uuid,
}).strict();

export type UpdateTrackedPublicOrderInput = z.infer<typeof updateTrackedPublicOrderSchema>;
export type CancelTrackedPublicOrderInput = z.infer<typeof cancelTrackedPublicOrderSchema>;
