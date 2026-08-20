import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import { createReportScheduleTranslator, reportScheduleMessages } from "@/lib/messages/report-schedules";

describe("report schedule messages", () => {
  it("defines every message in all supported application locales", () => {
    const keys = Object.keys(reportScheduleMessages["zh-TW"]);
    for (const locale of APP_LOCALES) {
      expect(Object.keys(reportScheduleMessages[locale])).toEqual(keys);
      expect(Object.values(reportScheduleMessages[locale]).every(Boolean)).toBe(true);
    }
  });

  it("formats schedule values through the selected locale", () => {
    const t = createReportScheduleTranslator("en");
    expect(t("schedule.recipientCount", { count: 3 })).toBe("3 recipients");
    expect(t("schedule.confirmTest", { name: "Closing report" })).toContain("Closing report");
  });
});
