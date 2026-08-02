import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  getZodFieldErrors,
  parseFieldErrors,
  withoutFieldError,
} from "./form-field-errors";

describe("form field errors", () => {
  it("保留繁體中文自訂訊息，並只保留每個欄位的第一個錯誤", () => {
    const schema = z.object({
      name: z.string().min(1, "請填寫名稱。").max(2, "名稱過長。"),
    });
    const result = schema.safeParse({ name: "" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(getZodFieldErrors(result.error, { name: "名稱" })).toEqual({
      name: "請填寫名稱。",
    });
  });

  it("將巢狀欄位的內建英文錯誤轉成繁體中文欄位提示", () => {
    const schema = z.object({
      theme: z.object({ logoUrl: z.string().url() }),
    });
    const result = schema.safeParse({ theme: { logoUrl: "不是網址" } });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(getZodFieldErrors(result.error, { logoUrl: "自訂標誌網址" })).toEqual({
      logoUrl: "「自訂標誌網址」輸入不正確，請依欄位限制重新輸入。",
    });
  });

  it("忽略非字串 API 錯誤並可清除指定欄位", () => {
    const parsed = parseFieldErrors({ name: "請填寫名稱。", count: 1, empty: "" });
    expect(parsed).toEqual({ name: "請填寫名稱。" });
    expect(withoutFieldError(parsed, "name")).toEqual({});
  });
});
