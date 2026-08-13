import { describe, expect, it } from "vitest";
import {
  APP_LOCALES,
  resolveAppLocale,
  resolveNavigatorLocale,
} from "@/lib/app-locale";
import { appMessages, getAppMessage } from "@/lib/app-messages";

describe("application locale negotiation", () => {
  it("uses a validated locale cookie ahead of Accept-Language", () => {
    expect(resolveAppLocale("ko", "ja,en;q=0.8")).toBe("ko");
  });

  it("ignores an invalid cookie and honors Accept-Language quality", () => {
    expect(resolveAppLocale("en-US", "en;q=0.5,vi;q=0.9,ja;q=0.7")).toBe("vi");
  });

  it("maps supported regional tags and falls back to Taiwan Traditional Chinese", () => {
    expect(resolveAppLocale(undefined, "ja-JP,en-US;q=0.8")).toBe("ja");
    expect(resolveAppLocale(undefined, "zh-Hant-HK,en;q=0.5")).toBe("zh-TW");
    expect(resolveAppLocale(undefined, "de-DE,fr;q=0.8")).toBe("zh-TW");
  });

  it("negotiates the first supported navigator language", () => {
    expect(resolveNavigatorLocale(["fr-FR", "th-TH", "en-US"])).toBe("th");
  });
});

describe("application dictionaries", () => {
  it("keeps every supported locale on the same typed message contract", () => {
    const expectedKeys = Object.keys(appMessages["zh-TW"]).sort();
    for (const locale of APP_LOCALES) {
      expect(Object.keys(appMessages[locale]).sort()).toEqual(expectedKeys);
    }
  });

  it("interpolates shared login messages", () => {
    expect(getAppMessage("en", "login.oauth.useProvider", { provider: "Google" }))
      .toBe("Continue with Google");
  });
});
