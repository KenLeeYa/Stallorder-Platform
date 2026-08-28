import { z } from "zod";

export const operatingExpenseCommandSchema = z.object({
  operation: z.literal("CREATE_EXPENSE"),
  stallId: z.string().uuid().nullable().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum([
    "RENT",
    "UTILITIES",
    "PLATFORM_FEE",
    "DELIVERY_FEE",
    "MARKETING",
    "MAINTENANCE",
    "INSURANCE",
    "TAX",
    "OTHER",
  ]),
  amount: z.number().int().min(1).max(1_000_000_000),
  vendorName: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().min(1).max(300),
  isRecurring: z.boolean().default(false),
}).strict();

export type OperatingExpenseCommand = z.infer<typeof operatingExpenseCommandSchema>;
