import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getCashShiftRuntimeTotals } from "./cash-shifts";

describe("cash shift runtime ledger totals", () => {
  it("uses immutable cash movements so payment-method corrections stay balanced", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { type: "CASH_SALE", _sum: { amount: 150 } },
      { type: "CASH_OUT", _sum: { amount: 150 } },
    ]);

    const totals = await getCashShiftRuntimeTotals({
      cashMovement: { groupBy },
    } as never, {
      id: "88888888-8888-4888-8888-888888888888",
      stallId: "22222222-2222-4222-8222-222222222222",
      openingAmount: 1_000,
    });

    expect(groupBy).toHaveBeenCalledOnce();
    expect(totals).toEqual({
      cashSales: 150,
      cashIn: 0,
      cashOut: 150,
      cashRefund: 0,
      correction: 0,
      expectedAmount: 1_000,
    });
  });
});
