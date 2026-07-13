import { describe, expect, it } from "vitest";
import { isCompletePickupCode, normalizePickupCode } from "./pickup-code";

describe("取餐碼輸入", () => {
  it("只保留前六位數字", () => {
    expect(normalizePickupCode("12a34-567")).toBe("123456");
  });

  it("輸入完整六位數才進行驗證", () => {
    expect(isCompletePickupCode("12345")).toBe(false);
    expect(isCompletePickupCode("123456")).toBe(true);
    expect(isCompletePickupCode("12345a")).toBe(false);
  });
});
