import { describe, expect, it } from "vitest";
import { PHONE_INPUT_PATTERN } from "./phone-input-pattern";

describe("電話輸入 pattern", () => {
  it("可由 HTML pattern 使用的 v flag 編譯", () => {
    expect(PHONE_INPUT_PATTERN).toBe("\\+?[0-9][0-9 \\(\\).\\x2d]{5,29}");
    expect(() => new RegExp(PHONE_INPUT_PATTERN, "v")).not.toThrow();
  });

  const pattern = new RegExp(`^(?:${PHONE_INPUT_PATTERN})$`, "v");

  it.each([
    "123456",
    "0912-345-678",
    "+886 912 345 678",
    "+886 (2) 1234-5678",
  ])("接受有效電話：%s", (value) => {
    expect(pattern.test(value)).toBe(true);
  });

  it.each([
    "12345",
    "+12345",
    "0912/345678",
    "0912_345_678",
    "phone123",
  ])("拒絕無效電話：%s", (value) => {
    expect(pattern.test(value)).toBe(false);
  });
});
