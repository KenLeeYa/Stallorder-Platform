import { describe, expect, it } from "vitest";
import { fulfillmentTimeBlocksProduction, fulfillmentTimeCommandSchema } from "./fulfillment-time";

describe("fulfillment time commands", () => {
  it("accepts versioned confirmation and proposal commands", () => {
    expect(fulfillmentTimeCommandSchema.safeParse({
      operation: "CONFIRM_REQUESTED",
      version: 1,
    }).success).toBe(true);
    expect(fulfillmentTimeCommandSchema.safeParse({
      operation: "PROPOSE",
      version: 2,
      proposedFulfillmentAt: "2026-08-07T12:30:00+08:00",
      reason: "原時段產能已滿",
    }).success).toBe(true);
  });

  it("rejects stale versions, invalid times, multiline reasons and extra fields", () => {
    expect(fulfillmentTimeCommandSchema.safeParse({
      operation: "CONFIRM_REQUESTED",
      version: 0,
    }).success).toBe(false);
    expect(fulfillmentTimeCommandSchema.safeParse({
      operation: "PROPOSE",
      version: 1,
      proposedFulfillmentAt: "tomorrow",
      reason: "產能不足\n請改期",
      hidden: true,
    }).success).toBe(false);
  });

  it("blocks production while the requested or proposed time is unresolved", () => {
    expect(fulfillmentTimeBlocksProduction("REQUESTED")).toBe(true);
    expect(fulfillmentTimeBlocksProduction("CUSTOMER_ACTION_REQUIRED")).toBe(true);
    expect(fulfillmentTimeBlocksProduction("CONFIRMED")).toBe(false);
  });
});
