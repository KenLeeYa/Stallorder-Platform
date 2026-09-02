import { describe, expect, it } from "vitest";
import { operatingExpenseCommandSchema } from "@/server/finance/operating-profit-contract";

describe("operating expense contract", () => {
  it("accepts a scoped utility expense", () => {
    const result = operatingExpenseCommandSchema.parse({
      operation: "CREATE_EXPENSE",
      stallId: "22222222-2222-4222-8222-222222222222",
      expenseDate: "2026-08-29",
      category: "UTILITIES",
      amount: 3500,
      vendorName: "台電",
      description: "八月電費",
      isRecurring: true,
    });
    expect(result).toMatchObject({ amount: 3500, isRecurring: true });
  });

  it("requires a positive amount and a useful description", () => {
    expect(operatingExpenseCommandSchema.safeParse({
      operation: "CREATE_EXPENSE",
      expenseDate: "2026-08-29",
      category: "OTHER",
      amount: 0,
      description: "",
    }).success).toBe(false);
  });

  it("requires a merchant-defined name for other expenses", () => {
    expect(operatingExpenseCommandSchema.safeParse({
      operation: "CREATE_EXPENSE",
      expenseDate: "2026-08-29",
      category: "OTHER",
      amount: 300,
      description: "臨時採買",
    }).success).toBe(false);

    const result = operatingExpenseCommandSchema.parse({
      operation: "CREATE_EXPENSE",
      expenseDate: "2026-08-29",
      category: "OTHER",
      customCategoryName: "瓦斯罐",
      amount: 300,
      description: "臨時採買",
    });
    expect(result.customCategoryName).toBe("瓦斯罐");
  });

  it("keeps custom names exclusive to the other category", () => {
    expect(operatingExpenseCommandSchema.safeParse({
      operation: "CREATE_EXPENSE",
      expenseDate: "2026-08-29",
      category: "RENT",
      customCategoryName: "自訂租金",
      amount: 300,
      description: "不應通過",
    }).success).toBe(false);
  });

  it("accepts a correction that identifies the original expense and reason", () => {
    const result = operatingExpenseCommandSchema.parse({
      operation: "CORRECT_EXPENSE",
      expenseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      correctionReason: "原收款方與金額登錄錯誤",
      stallId: "22222222-2222-4222-8222-222222222222",
      expenseDate: "2026-08-30",
      category: "UTILITIES",
      amount: 4200,
      vendorName: "台電",
      description: "八月電費更正版",
      isRecurring: true,
    });

    expect(result).toMatchObject({
      operation: "CORRECT_EXPENSE",
      amount: 4200,
      correctionReason: "原收款方與金額登錄錯誤",
    });
  });

  it("rejects a correction without an audit reason", () => {
    expect(operatingExpenseCommandSchema.safeParse({
      operation: "CORRECT_EXPENSE",
      expenseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      correctionReason: "",
      expenseDate: "2026-08-30",
      category: "RENT",
      amount: 20000,
      description: "九月租金",
      isRecurring: false,
    }).success).toBe(false);
  });
});
