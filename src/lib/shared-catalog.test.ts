import { describe, expect, it } from "vitest";
import { effectiveProductPrice } from "./shared-catalog";

describe("effectiveProductPrice", () => {
  it("uses the organization default when no stall override exists", () => {
    expect(effectiveProductPrice(95, null)).toBe(95);
  });

  it("uses a stall-specific override, including zero", () => {
    expect(effectiveProductPrice(95, 85)).toBe(85);
    expect(effectiveProductPrice(95, 0)).toBe(0);
  });
});
