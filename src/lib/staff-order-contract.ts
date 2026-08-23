import { z } from "zod";
import {
  multilineText,
  optionalPhoneNumberSchema,
  singleLineText,
} from "./input-validation";

const checkoutSchema = z.object({
  paymentOptionId: z.string().uuid().nullable().optional(),
  discountOptionId: z.string().uuid().nullable().optional(),
  cashReceived: z.number().int().min(0).max(100_000_000).nullable().optional(),
  discountApprovalReason: z.string().trim().min(1).max(200).nullable().optional(),
  managerEmail: z.string().trim().email().max(254).nullable().optional(),
  managerPassword: z.string().min(1).max(128).nullable().optional(),
  managerAuthorizationCode: z.string().trim().regex(/^\d{4,8}$/).nullable().optional(),
}).strict();

const itemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
  note: multilineText({ maximum: 1000 }).optional().default(""),
  noteOptionIds: z.array(z.string().uuid()).max(50).default([]),
  bundleChoiceIds: z.array(z.string().uuid()).max(400).default([]),
}).strict();

const baseOrderFields = {
  idempotencyKey: z.string().uuid(),
  customerName: singleLineText({ maximum: 50 }).optional().default(""),
  customerNote: multilineText({ maximum: 1000 }).optional().default(""),
  paymentTiming: z.enum(["PAY_NOW", "PAY_LATER"]),
  checkout: checkoutSchema.optional(),
  items: z.array(itemSchema).min(1).max(100),
};

export const createStaffOrderSchema = z.discriminatedUnion("fulfillmentType", [
  z.object({
    ...baseOrderFields,
    fulfillmentType: z.literal("TAKEOUT"),
    customerPhone: optionalPhoneNumberSchema.optional().default(""),
    requestedFulfillmentAt: z.string().datetime({ offset: true }).nullable().optional().default(null),
  }).strict(),
  z.object({
    ...baseOrderFields,
    fulfillmentType: z.literal("DINE_IN"),
    diningTableId: z.string().uuid(),
    customerPhone: optionalPhoneNumberSchema.optional().default(""),
  }).strict(),
  z.object({
    ...baseOrderFields,
    fulfillmentType: z.literal("DELIVERY"),
    customerPhone: optionalPhoneNumberSchema.optional().default(""),
    deliveryAddress: multilineText({ maximum: 300 }).optional().default(""),
    requestedFulfillmentAt: z.string().datetime({ offset: true }).nullable().optional().default(null),
  }).strict(),
]).superRefine((value, context) => {
  value.items.forEach((item, index) => {
    if (new Set(item.noteOptionIds).size !== item.noteOptionIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "noteOptionIds"], message: "註記不可重複。" });
    }
    if (new Set(item.bundleChoiceIds).size !== item.bundleChoiceIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "bundleChoiceIds"], message: "套餐選項不可重複。" });
    }
  });
  const configurationKeys = value.items.map((item) => JSON.stringify([
    item.productId,
    item.note,
    [...item.noteOptionIds].sort(),
    [...item.bundleChoiceIds].sort(),
  ]));
  if (new Set(configurationKeys).size !== configurationKeys.length) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "相同商品與註記設定不可重複，請合併數量。",
    });
  }
  if (value.paymentTiming === "PAY_NOW" && !value.checkout) {
    context.addIssue({ code: "custom", path: ["checkout"], message: "立即結帳需要付款資料。" });
  }
});

export type CreateStaffOrderInput = z.infer<typeof createStaffOrderSchema>;

export type StaffOrderCatalog = {
  products: Array<{
    id: string;
    name: string;
    description: string;
    translations?: Array<{ locale: string; name: string; description: string }>;
    category: string;
    categoryTranslations?: Array<{ locale: string; name: string }>;
    group?: string | null;
    groupTranslations?: Array<{ locale: string; name: string }>;
    price: number;
    imageUrl: string | null;
    isOrderDiscountEligible: boolean;
    kind?: "SINGLE" | "BUNDLE";
    bundleChoiceGroups?: Array<{
      id: string;
      name: string;
      minSelections: number;
      maxSelections: number;
      choices: Array<{
        id: string;
        name: string;
        translations?: Array<{ locale: string; name: string; description: string }>;
        quantity: number;
        priceDelta: number;
      }>;
    }>;
    noteGroups: Array<{
      id: string;
      name: string;
      translations?: Array<{ locale: string; name: string }>;
      selectionMode: "SINGLE" | "MULTIPLE";
      isRequired: boolean;
      minSelections: number;
      maxSelections: number | null;
      options: Array<{
        id: string;
        name: string;
        translations?: Array<{ locale: string; name: string }>;
        priceDelta: number;
      }>;
    }>;
  }>;
  tables: Array<{ id: string; label: string; floorId: string | null; floorName: string }>;
  fulfillmentSlots: string[];
  limits: {
    maxItemQuantity: number;
    maxUniqueProducts: number;
    maxTotalQuantity: number;
    maxNoteLength: number;
  };
};
