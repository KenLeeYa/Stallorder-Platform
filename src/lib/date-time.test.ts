import { describe, expect, it } from "vitest";
import {
  calendarDateInTimeZone,
  formatTaipeiDateTime,
  zonedCalendarDateRangeUtc,
  zonedCalendarDayUtcRange,
} from "./date-time";

describe("台北時間格式", () => {
  it("在伺服器與瀏覽器皆產生固定格式", () => {
    expect(formatTaipeiDateTime("2026-07-15T17:55:23.000Z")).toBe("2026/07/16 01:55:23");
  });

  it("以攤位時區建立當日查詢邊界", () => {
    expect(zonedCalendarDayUtcRange(new Date("2026-08-23T12:00:00Z"), "Asia/Taipei"))
      .toEqual({
        from: new Date("2026-08-22T16:00:00Z"),
        to: new Date("2026-08-23T16:00:00Z"),
      });
  });

  it("保留日光節約時間切換日的實際長度", () => {
    const range = zonedCalendarDayUtcRange(new Date("2026-03-08T16:00:00Z"), "America/New_York");
    expect(range.from).toEqual(new Date("2026-03-08T05:00:00Z"));
    expect(range.to).toEqual(new Date("2026-03-09T04:00:00Z"));
  });

  it("建立台北日期鍵與多日查詢的排他 UTC 邊界", () => {
    expect(calendarDateInTimeZone(new Date("2026-08-27T16:30:00Z"), "Asia/Taipei")).toBe("2026-08-28");
    expect(zonedCalendarDateRangeUtc("2026-08-28", "2026-08-28", "Asia/Taipei")).toEqual({
      from: new Date("2026-08-27T16:00:00Z"),
      to: new Date("2026-08-28T16:00:00Z"),
    });
  });
});
