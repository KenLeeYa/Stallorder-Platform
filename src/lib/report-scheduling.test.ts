import { describe, expect, it } from "vitest";
import { nextScheduledRun, reportPeriodForRun, reportScheduleInputSchema } from "./report-scheduling";

describe("report scheduling", () => {
  it("計算台北時區下一次每日寄送時間", () => {
    const next = nextScheduledRun({
      reportType: "DAILY_SALES",
      timezone: "Asia/Taipei",
      sendHour: 9,
      sendMinute: 30,
      dayOfWeek: null,
    }, new Date("2026-07-15T00:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-07-15T01:30:00.000Z");
  });

  it("時間已過時排到隔日", () => {
    const next = nextScheduledRun({
      reportType: "DAILY_SALES",
      timezone: "Asia/Taipei",
      sendHour: 9,
      sendMinute: 30,
      dayOfWeek: null,
    }, new Date("2026-07-15T02:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-07-16T01:30:00.000Z");
  });

  it("週報涵蓋寄送日前七天", () => {
    expect(reportPeriodForRun("WEEKLY_SALES", new Date("2026-07-20T00:30:00.000Z"), "Asia/Taipei")).toEqual({
      periodStart: "2026-07-13",
      periodEnd: "2026-07-19",
    });
  });

  it("拒絕重複收件人與週報缺少星期", () => {
    const result = reportScheduleInputSchema.safeParse({
      name: "週報",
      reportType: "WEEKLY_SALES",
      recipients: ["OWNER@example.com", "owner@example.com"],
      stallIds: ["11111111-1111-4111-8111-111111111111"],
      timezone: "Asia/Taipei",
      sendHour: 8,
      sendMinute: 0,
      dayOfWeek: null,
      isEnabled: true,
    });
    expect(result.success).toBe(false);
  });
});
