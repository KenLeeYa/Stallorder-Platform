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
});
