import { describe, expect, it } from "vitest";
import { isCompletePickupCode, normalizePickupCode } from "./pickup-code";

describe("取餐碼輸入", () => {
  it("新訂單只保留前三位數字", () => {
    expect(normalizePickupCode("12a34-567")).toBe("123");
  });

  it("輸入完整三位數才進行驗證", () => {
    expect(isCompletePickupCode("12")).toBe(false);
    expect(isCompletePickupCode("123")).toBe(true);
    expect(isCompletePickupCode("12a")).toBe(false);
  });

  it("部署前訂單仍可使用原六位數取餐碼", () => {
    expect(normalizePickupCode("12a34-567", 6)).toBe("123456");
    expect(isCompletePickupCode("123456", 6)).toBe(true);
  });
});
