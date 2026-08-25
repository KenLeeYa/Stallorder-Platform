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

  it("uses concise report descriptions for merchant staff", () => {
    expect(getReportMessage("zh-TW", "reports.orders.description")).toBe("依日期查看每張訂單的狀態與品項。");
    expect(getReportMessage("zh-TW", "reports.cash.description")).toBe("查看每個班次的現金收支與盤點差額。");
  });
});
