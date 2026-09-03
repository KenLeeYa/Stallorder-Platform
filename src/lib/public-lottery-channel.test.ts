import { describe, expect, it } from "vitest";
import { publicLotteryChannelAllows } from "@/lib/public-lottery-channel";

describe("public lottery channel policy", () => {
  it.each([
    ["DEFAULT", "DINE_IN", true],
    ["DEFAULT", "TAKEOUT", true],
    ["PREORDER", "TAKEOUT", false],
    ["DELIVERY", "DELIVERY", false],
    ["DEFAULT", "DELIVERY", false],
  ] as const)(
    "%s / %s resolves to %s",
    (orderingMode, fulfillmentType, expected) => {
      expect(publicLotteryChannelAllows(orderingMode, fulfillmentType)).toBe(expected);
    },
  );
});
