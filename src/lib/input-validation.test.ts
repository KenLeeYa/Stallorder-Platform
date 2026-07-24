import { describe, expect, it } from "vitest";
import {
  multilineText,
  optionalPhoneNumberSchema,
  phoneNumberSchema,
  singleLineText,
} from "./input-validation";

describe("input validation", () => {
  it("accepts practical Taiwan and international phone formats", () => {
    expect(phoneNumberSchema.parse("0916-166-504")).toBe("0916-166-504");
    expect(phoneNumberSchema.parse("+886 916 166 504")).toBe("+886 916 166 504");
    expect(optionalPhoneNumberSchema.parse("")).toBe("");
  });

  it("rejects letters and unrelated markup in phone fields", () => {
    expect(phoneNumberSchema.safeParse("call-me-now").success).toBe(false);
    expect(phoneNumberSchema.safeParse("<script>alert(1)</script>").success).toBe(false);
  });

  it("rejects control characters from single-line fields", () => {
    const schema = singleLineText({ minimum: 1, maximum: 80 });
    expect(schema.safeParse("正常店名").success).toBe(true);
    expect(schema.safeParse("第一行\n第二行").success).toBe(false);
    expect(schema.safeParse(`名稱${String.fromCharCode(0)}內容`).success).toBe(false);
  });

  it("allows line breaks but rejects hidden controls in multiline fields", () => {
    const schema = multilineText({ maximum: 500 });
    expect(schema.safeParse("第一行\n第二行").success).toBe(true);
    expect(schema.safeParse(`說明${String.fromCharCode(7)}內容`).success).toBe(false);
  });
});
