import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import { onboardingMessages } from "@/lib/messages/onboarding";

describe("onboarding message catalog", () => {
  it("provides every onboarding key in all application locales", () => {
    const canonicalKeys = Object.keys(onboardingMessages.messages["zh-TW"]);
    expect(Object.keys(onboardingMessages.messages)).toEqual(APP_LOCALES);
    for (const locale of APP_LOCALES) {
      expect(Object.keys(onboardingMessages.messages[locale])).toEqual(canonicalKeys);
      expect(Object.values(onboardingMessages.messages[locale]).every((message) => message.trim().length > 0)).toBe(true);
    }
  });

  it("keeps platform-provided notes unchanged inside localized UI", () => {
    expect(onboardingMessages.get("vi", "needsInfo", { note: "請補上攤位照片" }))
      .toContain("請補上攤位照片");
  });
});
