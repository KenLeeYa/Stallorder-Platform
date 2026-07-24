import { describe, expect, it } from "vitest";
import {
  localizedPublicOrderError,
  localizedQrCategory,
  preserveSupportedQrLocale,
  resolvePreferredQrLocale,
} from "./qr-order-i18n";

describe("commercial QR errors", () => {
  it("localizes the trial order hard limit", () => {
    expect(localizedPublicOrderError("zh-TW", "TRIAL_ORDER_LIMIT_REACHED")).toContain("試用訂單額度已用完");
    expect(localizedPublicOrderError("en", "TRIAL_ORDER_LIMIT_REACHED")).toContain("trial");
    expect(localizedPublicOrderError("zh-TW", "SUBSCRIPTION_SUSPENDED")).toContain("訂閱已停權");
  });
});

const allTranslations = ["en", "ja", "ko", "vi", "th"];

describe("QR 點餐瀏覽器語系", () => {
  it.each([
    ["en-US", "en"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["vi-VN", "vi"],
    ["th-TH", "th"],
    ["zh-Hant-TW", "zh-TW"],
    ["zh-HK", "zh-TW"],
  ])("將 %s 對應至 %s", (browserLocale, expected) => {
    expect(resolvePreferredQrLocale([browserLocale], allTranslations)).toBe(expected);
  });

  it("依瀏覽器偏好順序選擇商家有提供的語系", () => {
    expect(resolvePreferredQrLocale(["fr-FR", "ja-JP", "en-US"], ["en", "ja"])).toBe("ja");
  });

  it("商家未提供瀏覽器語系時回到繁體中文", () => {
    expect(resolvePreferredQrLocale(["ja-JP"], ["en"])).toBe("zh-TW");
    expect(resolvePreferredQrLocale(["fr-FR"], allTranslations)).toBe("zh-TW");
  });

  it("order session 完成時保留使用者已選且受支援的語系", () => {
    expect(preserveSupportedQrLocale("en", ["zh-TW"], ["en", "ja"])).toBe("en");
    expect(preserveSupportedQrLocale("ko", ["ja-JP"], ["en", "ja"])).toBe("ja");
  });
});

describe("QR 點餐介面翻譯", () => {
  it("翻譯既有商品分類", () => {
    expect(localizedQrCategory("en", "炸物")).toBe("Deep-fried food");
    expect(localizedQrCategory("ja", "炸物")).toBe("揚げ物");
    expect(localizedQrCategory("ko", "飲料")).toBe("음료");
    expect(localizedQrCategory("vi", "飲料")).toBe("Đồ uống");
    expect(localizedQrCategory("th", "炸物")).toBe("อาหารทอด");
  });

  it("使用目前語系顯示後端錯誤", () => {
    expect(localizedPublicOrderError("ja", "QR_REVOKED")).toContain("QRコード");
    expect(localizedPublicOrderError("th", "RATE_LIMITED")).toContain("บ่อยเกินไป");
  });
});
