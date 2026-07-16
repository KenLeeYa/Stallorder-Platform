import { afterEach, describe, expect, it } from "vitest";
import {
  getClientIp,
  hashToken,
  isLocalQaLoginRateLimitDisabled,
  isTrustedOrigin,
  safeEqual,
  sanitizeRedirectPath,
} from "./security";

const originalTrustedIpHeader = process.env.TRUSTED_CLIENT_IP_HEADER;

afterEach(() => {
  if (originalTrustedIpHeader === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
  else process.env.TRUSTED_CLIENT_IP_HEADER = originalTrustedIpHeader;
});

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
    expect(sanitizeRedirectPath("/%5cevil.example")).toBe("/");
    expect(sanitizeRedirectPath("/%2f%2fevil.example")).toBe("/");
    expect(sanitizeRedirectPath("/safe%0d%0aheader")).toBe("/");
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

  it("只信任明確設定且格式正確的代理 IP 標頭", () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(getClientIp(new Request("http://localhost", {
      headers: { "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "198.51.100.2" },
    }))).toBe("203.0.113.8");
    expect(getClientIp(new Request("http://localhost", {
      headers: { "cf-connecting-ip": "203.0.113.8, 198.51.100.2" },
    }))).toBe("unknown");

    process.env.TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";
    expect(getClientIp(new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.2" },
    }))).toBe("198.51.100.2");
    expect(getClientIp(new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.2, 203.0.113.8" },
    }))).toBe("unknown");

    delete process.env.TRUSTED_CLIENT_IP_HEADER;
    expect(getClientIp(new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.2" },
    }))).toBe("unknown");
  });
});

describe("本機 QA 登入限制", () => {
  it("必須明確啟用且網站與資料庫皆為本機位址", () => {
    expect(isLocalQaLoginRateLimitDisabled({
      LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT: "true",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3010",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    })).toBe(true);

    expect(isLocalQaLoginRateLimitDisabled({
      LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT: "false",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3010",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    })).toBe(false);

    expect(isLocalQaLoginRateLimitDisabled({
      LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT: "true",
      NEXT_PUBLIC_APP_URL: "https://stallorder.example",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    })).toBe(false);

    expect(isLocalQaLoginRateLimitDisabled({
      LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT: "true",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3010",
      DATABASE_URL: "postgresql://postgres:postgres@db.example/postgres",
    })).toBe(false);
  });
});
