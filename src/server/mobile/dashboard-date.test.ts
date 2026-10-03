import { describe, expect, it } from "vitest";
import { calendarDateInTimeZone } from "./dashboard-date";

describe("mobile dashboard calendar date", () => {
  it("uses the authorized stall time zone", () => {
    expect(calendarDateInTimeZone(
      new Date("2026-08-24T16:30:00.000Z"),
      "Asia/Taipei",
    )).toBe("2026-08-25");
  });

  it("fails closed for an invalid time zone", () => {
    expect(calendarDateInTimeZone(new Date(), "Invalid/TimeZone")).toBeNull();
  });
});
