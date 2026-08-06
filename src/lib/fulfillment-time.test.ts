import { describe, expect, it } from "vitest";
import {
  fulfillmentTimeBlocksProduction,
  fulfillmentTimeCommandSchema,
  isUninitializedLegacyQrTakeout,
  resolveFulfillmentTimeReadModel,
} from "./fulfillment-time";

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
    expect(fulfillmentTimeCommandSchema.safeParse({
      operation: "PROPOSE",
      version: 0,
      proposedFulfillmentAt: "2026-08-07T12:30:00+08:00",
      reason: "調整既有預約時間",
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

describe("legacy fulfillment time read model", () => {
  const legacyOrder = {
    source: "QR_MENU",
    fulfillmentType: "TAKEOUT",
    scheduledPickupAt: "2026-08-07T04:30:00.000Z",
    requestedFulfillmentAt: null,
    committedFulfillmentAt: null,
    pendingFulfillmentAt: null,
    fulfillmentTimeState: "NOT_REQUESTED" as const,
    fulfillmentTimeVersion: 0,
  };

  it("exposes a scheduled-only QR takeout upgrade fixture as confirmed", () => {
    expect(isUninitializedLegacyQrTakeout(legacyOrder)).toBe(true);
    expect(resolveFulfillmentTimeReadModel(legacyOrder)).toEqual({
      requestedFulfillmentAt: legacyOrder.scheduledPickupAt,
      committedFulfillmentAt: legacyOrder.scheduledPickupAt,
      fulfillmentTimeState: "CONFIRMED",
    });
  });

  it("does not reinterpret staff orders or initialized fulfillment state", () => {
    expect(isUninitializedLegacyQrTakeout({
      ...legacyOrder,
      source: "STAFF_POS",
    })).toBe(false);
    expect(isUninitializedLegacyQrTakeout({
      ...legacyOrder,
      scheduledPickupAt: null,
    })).toBe(false);
    expect(resolveFulfillmentTimeReadModel({
      ...legacyOrder,
      source: "STAFF_POS",
    })).toEqual({
      requestedFulfillmentAt: null,
      committedFulfillmentAt: null,
      fulfillmentTimeState: "NOT_REQUESTED",
    });

    expect(resolveFulfillmentTimeReadModel({
      ...legacyOrder,
      requestedFulfillmentAt: legacyOrder.scheduledPickupAt,
      fulfillmentTimeState: "REQUESTED",
      fulfillmentTimeVersion: 1,
    })).toEqual({
      requestedFulfillmentAt: legacyOrder.scheduledPickupAt,
      committedFulfillmentAt: null,
      fulfillmentTimeState: "REQUESTED",
    });
  });

  it("keeps the original scheduled time visible after a legacy order receives a proposal", () => {
    expect(resolveFulfillmentTimeReadModel({
      ...legacyOrder,
      pendingFulfillmentAt: "2026-08-07T05:00:00.000Z",
      fulfillmentTimeState: "CUSTOMER_ACTION_REQUIRED",
      fulfillmentTimeVersion: 1,
    })).toEqual({
      requestedFulfillmentAt: legacyOrder.scheduledPickupAt,
      committedFulfillmentAt: legacyOrder.scheduledPickupAt,
      fulfillmentTimeState: "CUSTOMER_ACTION_REQUIRED",
    });
  });
});
