import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import { getReportMessage, reportMessages } from "@/lib/messages/reports";

describe("report messages", () => {
  it("keeps all six dictionaries complete", () => {
    const keys = Object.keys(reportMessages["zh-TW"]);
    APP_LOCALES.forEach((locale) => expect(Object.keys(reportMessages[locale])).toEqual(keys));
  });

  it("preserves the distinction between order registration and receipts", () => {
    expect(getReportMessage("en", "reports.orderEntryAmount")).toBe("Order-entry amount");
    expect(getReportMessage("vi", "reports.cash.sales")).toBe("Tiền mặt thực thu");
  });
});
