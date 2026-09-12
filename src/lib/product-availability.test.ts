import { describe, expect, it } from "vitest";
import { isProductSoldOut, productAvailabilityLabel } from "./product-availability";

describe("timed product availability", () => {
  const deadline = "2026-09-11T16:00:00Z";
  const assignment = { isEnabled: true, isSoldOut: true, soldOutUntil: deadline, stockRemaining: 5 };
  it("resumes at the exact deadline even if the old sold-out flag remains stored", () => {
    expect(isProductSoldOut(assignment, new Date("2026-09-11T15:59:59Z"))).toBe(true);
    expect(isProductSoldOut(assignment, new Date(deadline))).toBe(false);
    expect(productAvailabilityLabel(assignment, new Date(deadline))).toBe("供應中");
  });
  it("never refills zero stock or resumes a permanently delisted item", () => {
    expect(productAvailabilityLabel({ ...assignment, stockRemaining: 0 }, new Date(deadline))).toBe("庫存售完");
    expect(productAvailabilityLabel({ ...assignment, isEnabled: false }, new Date(deadline))).toBe("永久下架");
  });
  it("does not let a stale deadline override an explicit available state", () => {
    expect(isProductSoldOut({ ...assignment, isSoldOut: false }, new Date("2026-09-10"))).toBe(false);
  });
});
