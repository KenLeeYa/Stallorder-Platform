import { describe, expect, it } from "vitest";
import { isValidPublicIdentifier, PUBLIC_IDENTIFIER_MAX_LENGTH } from "./public-identifier";
import { generatePublicIdentifierSuggestion } from "./public-identifier-suggestion";

describe("公開識別名稱建議", () => {
  it.each([
    ["越好吃一中店", "yue-hao-chi-yi-zhong-dian"],
    ["阿明雞排 2026", "a-ming-ji-pai-2026"],
    ["臺灣餐車", "tai-wan-can-che"],
    ["Lazy Toast", "lazy-toast"],
    ["ABC 餐車", "abc-can-che"],
  ])("將商家名稱 %s 轉換為 %s", (merchantName, expected) => {
    expect(generatePublicIdentifierSuggestion(merchantName)).toBe(expected);
  });

  it("產生符合格式且不超過長度限制的結果", () => {
    const suggestion = generatePublicIdentifierSuggestion("超級無敵長長長長長長長長長長長長長長長長長長長長商家");

    expect(suggestion.length).toBeLessThanOrEqual(PUBLIC_IDENTIFIER_MAX_LENGTH);
    expect(isValidPublicIdentifier(suggestion)).toBe(true);
  });

  it.each([
    ["A", "a-stall"],
    ["🎉", "stall"],
    ["", ""],
  ])("處理無法直接形成有效識別名稱的輸入：%s", (merchantName, expected) => {
    expect(generatePublicIdentifierSuggestion(merchantName)).toBe(expected);
  });
});
