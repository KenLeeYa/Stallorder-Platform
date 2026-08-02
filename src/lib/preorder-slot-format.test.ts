import { describe, expect, it } from "vitest";
import { formatPreorderSlot } from "./preorder-slot-format";

describe("formatPreorderSlot", () => {
  it("uses the stall timezone instead of the browser or server timezone", () => {
    const value = "2099-08-03T04:00:00.000Z";

    expect(formatPreorderSlot(value, "zh-TW", "Asia/Taipei")).toContain("下午12:00");
    expect(formatPreorderSlot(value, "zh-TW", "Asia/Tokyo")).toContain("下午01:00");
  });

  it("normalizes locale-specific spacing for stable server hydration", () => {
    const formatted = formatPreorderSlot(
      "2099-08-03T04:00:00.000Z",
      "zh-TW",
      "Asia/Taipei",
    );

    expect(formatted).not.toMatch(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/u);
  });
});
