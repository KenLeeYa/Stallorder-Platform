import { describe, expect, it } from "vitest";
import {
  formatAppCurrency,
  formatAppDate,
  formatAppDateTime,
  formatAppNumber,
} from "@/lib/locale-format";

describe("locale format helpers", () => {
  it("formats numbers and currencies with the selected application locale", () => {
    expect(formatAppNumber("en", 1234.5)).toBe(
      new Intl.NumberFormat("en").format(1234.5),
    );
    expect(formatAppCurrency("ja", 1200, "JPY")).toBe(
      new Intl.NumberFormat("ja", { style: "currency", currency: "JPY" }).format(1200),
    );
  });

  it("formats date-only and date-time values through the same locale contract", () => {
    const value = new Date("2026-08-13T08:30:00.000Z");
    const dateOptions = { dateStyle: "long", timeZone: "Asia/Taipei" } as const;
    const dateTimeOptions = {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Taipei",
    } as const;

    expect(formatAppDate("zh-TW", value, dateOptions)).toBe(
      new Intl.DateTimeFormat("zh-TW", dateOptions).format(value),
    );
    expect(formatAppDateTime("th", value, dateTimeOptions)).toBe(
      new Intl.DateTimeFormat("th", dateTimeOptions).format(value),
    );
  });
});
