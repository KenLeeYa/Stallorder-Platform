import { z } from "zod";
import { merchantBusinessTypes } from "@/lib/merchant-application-contract";
import { singleLineText } from "@/lib/input-validation";

export const defaultMerchantBusinessTypeOptions = [
  { code: "NIGHT_MARKET_STALL", legacyType: "NIGHT_MARKET_STALL", name: "夜市攤位", sortOrder: 10 },
  { code: "FOOD_TRUCK", legacyType: "FOOD_TRUCK", name: "餐車", sortOrder: 20 },
  { code: "MARKET_STALL", legacyType: "MARKET_STALL", name: "市集攤位", sortOrder: 30 },
  { code: "POPUP_STORE", legacyType: "POPUP_STORE", name: "快閃店", sortOrder: 40 },
  { code: "SMALL_RESTAURANT", legacyType: "SMALL_RESTAURANT", name: "小型餐飲店", sortOrder: 50 },
  { code: "BEVERAGE_SHOP", legacyType: "BEVERAGE_SHOP", name: "飲料店", sortOrder: 60 },
  { code: "OTHER", legacyType: "OTHER", name: "其他", sortOrder: 70 },
] as const;

export type MerchantBusinessTypeOptionDto = {
  id?: string;
  code: string;
  legacyType: (typeof merchantBusinessTypes)[number];
  name: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
};

export const merchantBusinessTypeOptionCommandSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  legacyType: z.enum(merchantBusinessTypes),
  name: singleLineText({ minimum: 1, maximum: 80 }),
  description: singleLineText({ maximum: 300 }).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000),
  isActive: z.boolean(),
}).strict();

export type MerchantBusinessTypeOptionCommand = z.infer<typeof merchantBusinessTypeOptionCommandSchema>;
