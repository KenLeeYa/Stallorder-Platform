import { describe, expect, it } from "vitest";
import { isExpectedPublicSiteResponse } from "./production-smoke-public-site.mjs";

describe("Production public-site smoke contract", () => {
  it("accepts the branded root website on its own origin", () => {
    expect(isExpectedPublicSiteResponse({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<title>StallOrder | QR Code Ordering, POS and KDS</title>",
    })).toBe(true);
  });

  it.each([
    { status: 307, contentType: "text/html", body: "StallOrder" },
    { status: 200, contentType: "application/json", body: "StallOrder" },
    { status: 200, contentType: "text/html", body: "Unrelated website" },
  ])("rejects an invalid public-site response", ({ status, contentType, body }) => {
    expect(isExpectedPublicSiteResponse({
      status,
      contentType,
      body,
    })).toBe(false);
  });
});
