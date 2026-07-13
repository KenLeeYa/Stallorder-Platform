import { describe, expect, it } from "vitest";
import { hashToken, isTrustedOrigin, safeEqual, sanitizeRedirectPath } from "./security";

describe("安全工具", () => {
  it("使用固定長度雜湊保存 Token", () => {
    expect(hashToken("session-token")).toHaveLength(64);
    expect(hashToken("session-token")).not.toBe("session-token");
  });

  it("以常數時間比較同長度字串", () => {
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "diff")).toBe(false);
    expect(safeEqual("short", "longer")).toBe(false);
  });

  it("拒絕外部重新導向", () => {
    expect(sanitizeRedirectPath("/staff/demo")).toBe("/staff/demo");
    expect(sanitizeRedirectPath("//evil.example")).toBe("/");
    expect(sanitizeRedirectPath("https://evil.example")).toBe("/");
    expect(sanitizeRedirectPath("/safe\\evil")).toBe("/");
  });

  it("只接受同源寫入請求", () => {
    const trusted = new Request("http://localhost:3000/api/test", {
      headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    });
    const untrusted = new Request("http://localhost:3000/api/test", {
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(isTrustedOrigin(trusted)).toBe(true);
    expect(isTrustedOrigin(untrusted)).toBe(false);
  });
});
