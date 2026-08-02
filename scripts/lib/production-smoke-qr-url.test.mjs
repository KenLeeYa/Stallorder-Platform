import { describe, expect, it } from "vitest";

import {
  productionTestQrToken,
  resolveProductionTestQrUrl,
} from "./production-smoke-qr-url.mjs";

const baseUrl = "https://app.qidaigo.com";

describe("Production smoke QR URL", () => {
  it("allows Preview smoke to skip an unconfigured optional QR", () => {
    expect(
      resolveProductionTestQrUrl({ baseUrl, configuredUrl: undefined }),
    ).toBeNull();
  });

  it("fails closed when Production Apply does not configure a QR", () => {
    expect(() =>
      resolveProductionTestQrUrl({
        baseUrl,
        configuredUrl: "  ",
        required: true,
      }),
    ).toThrow("PRODUCTION_TEST_QR_URL is required");
  });

  it("accepts a same-origin dedicated QR route", () => {
    const url = resolveProductionTestQrUrl({
      baseUrl,
      configuredUrl: "/q/dedicated-production-test-token",
      required: true,
    });
    expect(url?.href).toBe(
      "https://app.qidaigo.com/q/dedicated-production-test-token",
    );
    expect(productionTestQrToken(url)).toBe("dedicated-production-test-token");
  });

  it.each([
    "https://preview.example.com/q/dedicated-production-test-token",
    "/merchant/dashboard",
    "/q/",
    "/q/too-short",
    "/q/dedicated-production-test-token%2Fescape",
  ])("rejects an unsafe configured QR URL: %s", (configuredUrl) => {
    expect(() =>
      resolveProductionTestQrUrl({ baseUrl, configuredUrl, required: true }),
    ).toThrow();
  });
});
