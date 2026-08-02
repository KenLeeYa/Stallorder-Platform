import { describe, expect, it } from "vitest";
import {
  getStaffCheckoutPreview,
  getStaffDiscountState,
} from "@/lib/staff-discount-presentation";

describe("getStaffDiscountState", () => {
  it("distinguishes disabled, empty and selectable discount states", () => {
    expect(getStaffDiscountState(false, 3)).toBe("DISABLED");
    expect(getStaffDiscountState(true, 0)).toBe("EMPTY");
    expect(getStaffDiscountState(true, 2)).toBe("AVAILABLE");
  });
});

describe("getStaffCheckoutPreview", () => {
  const lotteryOrder = { subtotal: 220, total: 198, discountLabel: "抽抽樂九折" };

  it("preserves an existing lottery discount when no staff discount is selected", () => {
    expect(getStaffCheckoutPreview([lotteryOrder], null)).toEqual({
      subtotal: 220,
      total: 198,
      discountAmount: 22,
      discountLabel: "抽抽樂九折",
    });
  });

  it("previews an explicitly selected staff discount from the trusted subtotal", () => {
    expect(getStaffCheckoutPreview([lotteryOrder], { name: "八折", rateBps: 8_000 })).toEqual({
      subtotal: 220,
      total: 176,
      discountAmount: 44,
      discountLabel: "八折",
    });
  });
});
