import { z } from "zod";

const expenseFields = {
  stallId: z.string().uuid().nullable().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum([
    "RENT",
    "UTILITIES",
    "PLATFORM_FEE",
    "DELIVERY_FEE",
    "MARKETING",
    "MAINTENANCE",
    "EQUIPMENT",
    "INSURANCE",
    "TAX",
    "OTHER",
  ]),
  customCategoryName: z.string().trim().min(2).max(40).nullable().optional(),
  amount: z.number().int().min(1).max(1_000_000_000),
  vendorName: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().min(1).max(300),
  isRecurring: z.boolean().default(false),
};

function addCategoryIssues(
  value: { category: string; customCategoryName?: string | null },
  context: z.RefinementCtx,
) {
  if (value.category === "OTHER" && !value.customCategoryName) {
    context.addIssue({
      code: "custom",
      path: ["customCategoryName"],
      message: "請輸入其他支出的品項名稱",
    });
  }
  if (value.category !== "OTHER" && value.customCategoryName) {
    context.addIssue({
      code: "custom",
      path: ["customCategoryName"],
      message: "只有其他支出可以使用自訂品項名稱",
    });
  }
}

const createOperatingExpenseCommandSchema = z.object({
  operation: z.literal("CREATE_EXPENSE"),
  ...expenseFields,
}).strict().superRefine(addCategoryIssues);

const correctOperatingExpenseCommandSchema = z.object({
  operation: z.literal("CORRECT_EXPENSE"),
  expenseId: z.string().uuid(),
  correctionReason: z.string().trim().min(2).max(300),
  ...expenseFields,
}).strict().superRefine(addCategoryIssues);

export const operatingExpenseCommandSchema = z.union([
  createOperatingExpenseCommandSchema,
  correctOperatingExpenseCommandSchema,
]);

export type OperatingExpenseCommand = z.infer<typeof operatingExpenseCommandSchema>;
