import { describe, expect, it } from "vitest";
import { describeUserAgent } from "@/lib/device-label";

describe("describeUserAgent", () => {
  it("identifies iPad Safari without asserting an unavailable exact hardware model", () => {
    expect(describeUserAgent(
      "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
    )).toBe("iPad · Safari");
  });

  it("recognizes iPadOS desktop-style user agents", () => {
    expect(describeUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    )).toBe("iPad · Safari");
  });

  it("identifies common Android and desktop browser families", () => {
    expect(describeUserAgent(
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36",
    )).toBe("Android phone · Chrome");
    expect(describeUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0",
    )).toBe("Windows · Edge");
  });

  it("returns a safe fallback when the user agent is absent", () => {
    expect(describeUserAgent(null)).toBe("Unknown browser");
  });
});
