import { z } from "zod";

export const productInputSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  price: z.number().int().min(0).max(10_000_000),
  sortOrder: z.number().int().min(0).max(10_000),
  isAvailable: z.boolean(),
}).strict();

export const productUpdateSchema = productInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "至少需要一個更新欄位。" },
);

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
}).strict();

export const categoryUpdateSchema = categoryInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "至少需要一個更新欄位。" },
);
