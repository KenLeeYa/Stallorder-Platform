import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import { publicOrderMessages } from "@/lib/messages/public-order";

describe("public order message catalog", () => {
  it("provides every order tracking key in all six locales", () => {
    const canonicalKeys = Object.keys(publicOrderMessages.messages["zh-TW"]);
    expect(Object.keys(publicOrderMessages.messages)).toEqual(APP_LOCALES);
    for (const locale of APP_LOCALES) {
      expect(Object.keys(publicOrderMessages.messages[locale])).toEqual(canonicalKeys);
      expect(Object.values(publicOrderMessages.messages[locale]).every((message) => message.trim().length > 0)).toBe(true);
    }
  });

  it("interpolates Vietnamese order status values", () => {
    expect(publicOrderMessages.get("vi", "orderNumber", { number: "A-12" })).toBe("Đơn A-12");
    expect(publicOrderMessages.get("vi", "waitEstimate", { minutes: 15 })).toContain("15");
  });
});
