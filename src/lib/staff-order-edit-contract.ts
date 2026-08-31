import { z } from "zod";

const existingItemSchema = z.object({
  kind: z.literal("EXISTING"),
  itemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
}).strict();

const newItemSchema = z.object({
  kind: z.literal("NEW"),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
  note: z.string().trim().max(1000).default(""),
  noteOptionIds: z.array(z.string().uuid()).max(50).default([]),
  bundleChoiceIds: z.array(z.string().uuid()).max(400).default([]),
}).strict();

const publicOrderAmendmentSchema = z.object({
  reason: z.enum([
    "SOLD_OUT_REMOVE",
    "SOLD_OUT_REPLACE",
    "QUANTITY_ADJUSTMENT",
    "OTHER",
  ]),
  customerMessage: z.string().trim().min(2, "請填寫要通知顧客的內容。").max(200),
}).strict();

export const updateStaffOrderItemsSchema = z.object({
  items: z.array(z.discriminatedUnion("kind", [existingItemSchema, newItemSchema])).min(1).max(100),
  publicAmendment: publicOrderAmendmentSchema.optional(),
}).strict().superRefine((value, context) => {
  const existingIds = value.items
    .filter((item): item is z.infer<typeof existingItemSchema> => item.kind === "EXISTING")
    .map((item) => item.itemId);
  if (new Set(existingIds).size !== existingIds.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "同一筆既有餐點不可重複。" });
  }

  const newItems = value.items.filter(
    (item): item is z.infer<typeof newItemSchema> => item.kind === "NEW",
  );
  newItems.forEach((item, index) => {
    if (new Set(item.noteOptionIds).size !== item.noteOptionIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "noteOptionIds"], message: "註記不可重複。" });
    }
    if (new Set(item.bundleChoiceIds).size !== item.bundleChoiceIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "bundleChoiceIds"], message: "套餐選項不可重複。" });
    }
  });
});

export type UpdateStaffOrderItemsInput = z.infer<typeof updateStaffOrderItemsSchema>;
