import { describe, expect, it } from "vitest";
import {
  buildFulfillmentTimeSlots,
  findFulfillmentTimeSlot,
  uniqueFulfillmentTimeValues,
} from "./fulfillment-time-options";

describe("fulfillment time picker options", () => {
  const slots = buildFulfillmentTimeSlots([
    "2026-08-07T01:00:00.000Z",
    "2026-08-07T04:30:00.000Z",
    "2026-08-07T05:05:00.000Z",
    "2026-08-07T16:00:00.000Z",
  ], "Asia/Taipei");

  it("derives calendar and zero-padded 24-hour fields in the stall timezone while retaining exact ISO values", () => {
    expect(slots).toEqual([
      expect.objectContaining({
        iso: "2026-08-07T01:00:00.000Z",
        date: "2026-08-07",
        hour: "09",
        minute: "00",
      }),
      expect.objectContaining({
        iso: "2026-08-07T04:30:00.000Z",
        date: "2026-08-07",
        hour: "12",
        minute: "30",
      }),
      expect.objectContaining({
        iso: "2026-08-07T05:05:00.000Z",
        date: "2026-08-07",
        hour: "13",
        minute: "05",
      }),
      expect.objectContaining({
        iso: "2026-08-07T16:00:00.000Z",
        date: "2026-08-08",
        hour: "00",
        minute: "00",
      }),
    ]);
  });

  it("resolves each parent-field change to the first exact server slot that remains valid", () => {
    expect(findFulfillmentTimeSlot(slots, { date: "2026-08-07" })?.iso)
      .toBe("2026-08-07T01:00:00.000Z");
    expect(findFulfillmentTimeSlot(slots, { date: "2026-08-07", hour: "13" })?.iso)
      .toBe("2026-08-07T05:05:00.000Z");
    expect(findFulfillmentTimeSlot(slots, {
      date: "2026-08-07",
      hour: "12",
      minute: "30",
    })?.iso).toBe("2026-08-07T04:30:00.000Z");
    expect(findFulfillmentTimeSlot(slots, { date: "2026-08-09" })).toBeNull();
  });

  it("deduplicates input and exposes only exact five-minute server slots", () => {
    const result = buildFulfillmentTimeSlots([
      "2026-08-07T04:00:00.000Z",
      "2026-08-07T04:00:00.000Z",
      "2026-08-07T04:05:00.000Z",
      "2026-08-07T04:07:00.000Z",
      "2026-08-07T04:10:30.000Z",
      "not-a-date",
      "2026-08-07T04:55:00.000Z",
    ], "Asia/Taipei");

    expect(result.map((slot) => slot.minute)).toEqual(["00", "05", "55"]);
    expect(uniqueFulfillmentTimeValues(result, "minute")).toEqual(["00", "05", "55"]);
    expect(result.map((slot) => slot.iso)).not.toContain("2026-08-07T04:07:00.000Z");
    expect(result.map((slot) => slot.iso)).not.toContain("2026-08-07T04:10:30.000Z");
  });
});
