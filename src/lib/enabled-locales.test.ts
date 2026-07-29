import { describe, expect, it } from "vitest";
import {
  getEnabledTranslationLocales,
  getTranslationLocaleOptions,
  mergeEnabledLocales,
  normalizeEnabledLocales,
} from "./enabled-locales";

describe("enabled locales", () => {
  it("固定保留繁體中文並移除未知與重複語系", () => {
    expect(normalizeEnabledLocales(["ja", "ja", "unknown"])).toEqual(["zh-TW", "ja"]);
  });

  it("共用商品採用有效攤位語系聯集", () => {
    expect(mergeEnabledLocales([
      ["zh-TW", "en"],
      ["zh-TW", "vi"],
      ["invalid"],
    ])).toEqual(["zh-TW", "en", "vi"]);
  });

  it("商品翻譯欄位排除來源語系及已停用語系", () => {
    expect(getEnabledTranslationLocales(["zh-TW", "ko", "th"])).toEqual(["ko", "th"]);
    expect(getTranslationLocaleOptions(["zh-TW", "ko"])).toEqual([
      { locale: "ko", label: "韓文" },
    ]);
  });
});
