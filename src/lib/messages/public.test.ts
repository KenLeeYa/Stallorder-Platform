import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import { publicMessages } from "@/lib/messages/public";

describe("public message catalog", () => {
  it("provides every public key in all six application locales", () => {
    const canonicalKeys = Object.keys(publicMessages.messages["zh-TW"]);
    expect(Object.keys(publicMessages.messages)).toEqual(APP_LOCALES);
    for (const locale of APP_LOCALES) {
      expect(Object.keys(publicMessages.messages[locale])).toEqual(canonicalKeys);
      expect(Object.values(publicMessages.messages[locale]).every((message) => message.trim().length > 0)).toBe(true);
    }
  });

  it("keeps merchant names unchanged while localizing surrounding UI", () => {
    expect(publicMessages.get("vi", "storefrontMenuDescription", { stallName: "越好吃一中店" }))
      .toContain("越好吃一中店");
    expect(publicMessages.get("vi", "storefrontMenuDescription", { stallName: "越好吃一中店" }))
      .toContain("menu mới nhất");
  });
});
