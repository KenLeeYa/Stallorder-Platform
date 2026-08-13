import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import {
  getOperationsErrorMessage,
  getOperationsMessage,
  operationsMessages,
} from "@/lib/messages/operations";

describe("operations messages", () => {
  it("contains every operations key in all six locales", () => {
    const referenceKeys = Object.keys(operationsMessages["zh-TW"]);
    expect(referenceKeys.length).toBeGreaterThan(100);
    for (const locale of APP_LOCALES) {
      expect(Object.keys(operationsMessages[locale])).toEqual(referenceKeys);
      expect(Object.values(operationsMessages[locale]).every((message) => message.trim().length > 0)).toBe(true);
    }
  });

  it("interpolates operational values", () => {
    expect(getOperationsMessage("en", "kitchen.future.summary", {
      orders: 2,
      items: 7,
    })).toBe("Future: 2 order(s) / 7 production item(s)");
  });

  it("maps stable API error codes without exposing server wording", () => {
    expect(getOperationsErrorMessage("vi", "PRODUCTION_NOT_DUE")).toContain("ngày kinh doanh");
    expect(getOperationsErrorMessage("ja", "UNKNOWN_CODE")).toBe("現在この操作を完了できません。");
  });
});
