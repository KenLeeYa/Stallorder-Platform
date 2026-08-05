import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  focusFirstInvalidField,
  getZodFieldErrors,
  parseFieldErrors,
  withoutFieldError,
} from "./form-field-errors";

describe("form field errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("欄位解除停用前會跨畫面更新重試聚焦", () => {
    const frames: FrameRequestCallback[] = [];
    let focused = false;
    let focusAttempts = 0;
    const focus = vi.fn(() => {
      focusAttempts += 1;
      focused = focusAttempts > 1;
    });
    const control = {
      focus,
      matches: vi.fn(() => focused),
    } as unknown as HTMLElement;
    const container = {
      querySelector: vi.fn(() => control),
    } as unknown as ParentNode;
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));

    focusFirstInvalidField(container, { resolutionStatus: "請選擇處理結果。" });
    while (frames.length > 0) frames.shift()?.(0);

    expect(focus).toHaveBeenCalledTimes(2);
    expect(control.matches).toHaveBeenCalledWith(":focus");
    expect(container.querySelector).toHaveBeenCalledWith('[data-field-key="resolutionStatus"]');
  });

  it("無法取得焦點時最多嘗試四次", () => {
    const frames: FrameRequestCallback[] = [];
    const focus = vi.fn();
    const control = {
      focus,
      matches: vi.fn(() => false),
    } as unknown as HTMLElement;
    const container = {
      querySelector: vi.fn(() => control),
    } as unknown as ParentNode;
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));

    focusFirstInvalidField(container, { reason: "請填寫原因。" });
    while (frames.length > 0) frames.shift()?.(0);

    expect(focus).toHaveBeenCalledTimes(4);
  });
});
