import { describe, expect, it } from "vitest";
import { calculateCashExpected, discountRequiresApproval } from "./operational-calculations";

describe("P1 營運計算", () => {
  it("以開班金額、現金銷售及收支計算系統應有金額", () => {
    expect(calculateCashExpected({
      openingAmount: 2_000,
      cashSales: 3_500,
      cashIn: 500,
      cashOut: 300,
      cashRefund: 200,
      correction: -100,
    })).toBe(5_400);
  });

  it("只有折扣超過門檻時要求經理核准", () => {
    expect(discountRequiresApproval(7_900, 8_000)).toBe(true);
    expect(discountRequiresApproval(8_000, 8_000)).toBe(false);
    expect(discountRequiresApproval(9_000, 8_000)).toBe(false);
  });
});
