import { describe, expect, it } from "vitest";
import {
  isValidPublicIdentifier,
  PUBLIC_IDENTIFIER_MAX_LENGTH,
} from "./public-identifier";

describe("公開識別名稱格式", () => {
  it.each([
    "abc",
    "a-1",
    "stall-2026",
    `a${"b".repeat(PUBLIC_IDENTIFIER_MAX_LENGTH - 2)}z`,
  ])("接受有效格式：%s", (value) => {
    expect(isValidPublicIdentifier(value)).toBe(true);
  });

  it.each([
    "ab",
    `a${"b".repeat(PUBLIC_IDENTIFIER_MAX_LENGTH)}z`,
    "-abc",
    "abc-",
    "ABC",
    "a_bc",
    "測試攤位",
    "a b",
  ])("拒絕無效格式：%s", (value) => {
    expect(isValidPublicIdentifier(value)).toBe(false);
  });
});
