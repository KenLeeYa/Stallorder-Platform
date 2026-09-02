import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, transactionMock } = vi.hoisted(() => {
  const transaction = {
    operatingExpense: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    stall: { findFirst: vi.fn() },
  };
  return {
    transactionMock: transaction,
    prismaMock: {
      $transaction: vi.fn(async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { applyOperatingExpenseCommand, OperatingProfitError } from "./operating-profit-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorProfileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const originalExpenseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("operating expense correction transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.operatingExpense.findFirst.mockResolvedValue({ id: originalExpenseId });
    transactionMock.operatingExpense.updateMany.mockResolvedValue({ count: 1 });
    transactionMock.operatingExpense.create.mockResolvedValue({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  });

  it("voids the original and creates its replacement in one serializable transaction", async () => {
    await applyOperatingExpenseCommand({
      organizationId,
      actorProfileId,
      command: {
        operation: "CORRECT_EXPENSE",
        expenseId: originalExpenseId,
        correctionReason: "原金額輸入錯誤",
        stallId: null,
        expenseDate: "2026-09-01",
        category: "UTILITIES",
        customCategoryName: null,
        amount: 4200,
        vendorName: "台電",
        description: "八月電費更正版",
        isRecurring: true,
      },
    });

    expect(transactionMock.operatingExpense.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: originalExpenseId, organizationId, voidedAt: null }),
      data: expect.objectContaining({
        voidedByProfileId: actorProfileId,
        voidReason: "原金額輸入錯誤",
        voidedAt: expect.any(Date),
      }),
    }));
    expect(transactionMock.operatingExpense.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId,
        amount: 4200,
        correctsExpenseId: originalExpenseId,
      }),
    }));
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("does not create a replacement when the original is already voided", async () => {
    transactionMock.operatingExpense.findFirst.mockResolvedValue(null);

    await expect(applyOperatingExpenseCommand({
      organizationId,
      actorProfileId,
      command: {
        operation: "CORRECT_EXPENSE",
        expenseId: originalExpenseId,
        correctionReason: "再次嘗試更正",
        stallId: null,
        expenseDate: "2026-09-01",
        category: "RENT",
        customCategoryName: null,
        amount: 20000,
        vendorName: null,
        description: "九月租金",
        isRecurring: false,
      },
    })).rejects.toEqual(expect.objectContaining<Partial<OperatingProfitError>>({
      code: "OPERATING_EXPENSE_NOT_CORRECTABLE",
    }));
    expect(transactionMock.operatingExpense.updateMany).not.toHaveBeenCalled();
    expect(transactionMock.operatingExpense.create).not.toHaveBeenCalled();
  });
});
