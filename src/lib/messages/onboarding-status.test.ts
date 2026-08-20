import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/lib/app-locale";
import { onboardingStatusMessages } from "@/lib/messages/onboarding-status";

describe("onboarding status message catalog", () => {
  it("provides every status key in all application locales", () => {
    const canonicalKeys = Object.keys(onboardingStatusMessages.messages["zh-TW"]);
    expect(Object.keys(onboardingStatusMessages.messages)).toEqual(APP_LOCALES);
    for (const locale of APP_LOCALES) {
      expect(Object.keys(onboardingStatusMessages.messages[locale])).toEqual(canonicalKeys);
      expect(Object.values(onboardingStatusMessages.messages[locale]).every((message) => message.trim().length > 0)).toBe(true);
    }
  });
});
