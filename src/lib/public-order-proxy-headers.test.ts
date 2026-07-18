import { describe, expect, it } from "vitest";
import {
  publicOrderUpstreamIpHeaders,
  trustedPublicOrderClientIp,
} from "./public-order-proxy-headers";

describe("public order proxy IP headers", () => {
  it("trusts only the single Vercel client IP in production", () => {
    expect(trustedPublicOrderClientIp(new Request("https://example.test", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.8",
        "x-real-ip": "198.51.100.2",
      },
    }), true)).toBe("203.0.113.8");

    expect(trustedPublicOrderClientIp(new Request("https://example.test", {
      headers: { "x-real-ip": "198.51.100.2" },
    }), true)).toBeNull();
  });

  it("rejects forwarded IP lists", () => {
    expect(trustedPublicOrderClientIp(new Request("https://example.test", {
      headers: { "x-vercel-forwarded-for": "203.0.113.8, 198.51.100.2" },
    }), true)).toBeNull();
  });

  it("never forwards Cloudflare's reserved client IP header", () => {
    expect(publicOrderUpstreamIpHeaders("203.0.113.8")).toEqual({
      "x-real-ip": "203.0.113.8",
    });
    expect(publicOrderUpstreamIpHeaders(null)).toEqual({});
  });
});
