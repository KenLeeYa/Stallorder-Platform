import { describe, expect, it } from "vitest";
import { calculateCheckout, calculateOrderDiscount, paymentMethodForKind } from "./checkout";

describe("結帳計算", () => {
  it("套用折扣後以整數金額計算應收與找零", () => {
    expect(calculateCheckout(275, 9000, 500)).toEqual({
      subtotal: 275,
      discountAmount: 27,
      total: 248,
      cashReceived: 500,
      changeAmount: 252,
    });
  });

  it("拒絕實收小於應收金額", () => {
    expect(() => calculateCheckout(275, 10_000, 200)).toThrow("INSUFFICIENT_CASH");
  });

  it("只將現金付款歸類為現金", () => {
    expect(paymentMethodForKind("CASH")).toBe("CASH");
    expect(paymentMethodForKind("LINE_PAY")).toBe("OTHER");
    expect(paymentMethodForKind("JKO_PAY")).toBe("OTHER");
    expect(paymentMethodForKind("CUSTOM")).toBe("OTHER");
  });

  it("only discounts the eligible subtotal", () => {
    expect(calculateOrderDiscount(150, 100, 9_000)).toEqual({
      subtotal: 150,
      discountEligibleSubtotal: 100,
      discountAmount: 10,
      total: 140,
    });
  });

  it("rejects an eligible subtotal outside the order subtotal", () => {
    expect(() => calculateOrderDiscount(100, 101, 9_000))
      .toThrow("INVALID_DISCOUNT_ELIGIBLE_SUBTOTAL");
  });
});
