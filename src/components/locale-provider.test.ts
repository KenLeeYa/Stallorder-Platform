import { describe, expect, it } from "vitest";
import {
  planInitialLocaleNegotiation,
  serializeLocaleCookie,
  shouldReloadForInitialLocale,
} from "@/components/locale-provider";

describe("locale cookie contract", () => {
  it("writes a long-lived, app-wide, same-site manual override", () => {
    expect(serializeLocaleCookie("ja", true)).toBe(
      "stallorder_locale=ja; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
  });

  it("plans one initial browser negotiation and stops after it starts", () => {
    expect(planInitialLocaleNegotiation(false, false, ["fr-FR", "ja-JP"]))
      .toBe("ja");
    expect(planInitialLocaleNegotiation(false, true, ["fr-FR", "ja-JP"]))
      .toBeNull();
    expect(planInitialLocaleNegotiation(true, false, ["ja-JP"]))
      .toBeNull();
  });

  it("reloads only when the browser locale differs from the server-rendered locale", () => {
    expect(shouldReloadForInitialLocale("zh-TW", "zh-TW")).toBe(false);
    expect(shouldReloadForInitialLocale("zh-TW", "en")).toBe(true);
  });
});
