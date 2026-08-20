import { describe, expect, it } from "vitest";
import {
  isExpectedCanonicalRedirect,
  isExpectedPublicSiteResponse,
} from "./production-smoke-public-site.mjs";

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

  it.each([
    { status: 301, location: "https://qidaigo.com/" },
    { status: 308, location: "https://qidaigo.com" },
  ])("accepts a permanent WWW redirect to the canonical public site", ({ status, location }) => {
    expect(isExpectedCanonicalRedirect({
      status,
      location,
      sourceUrl: "https://www.qidaigo.com/",
      canonicalUrl: "https://qidaigo.com/",
    })).toBe(true);
  });

  it.each([
    { status: 200, location: "https://qidaigo.com/" },
    { status: 302, location: "https://qidaigo.com/" },
    { status: 307, location: "https://qidaigo.com/" },
    { status: 308, location: null },
    { status: 308, location: "http://[" },
    { status: 308, location: "/" },
    { status: 308, location: "http://qidaigo.com/" },
    { status: 308, location: "https://app.qidaigo.com/" },
    { status: 308, location: "https://example.com/" },
    { status: 308, location: "https://qidaigo.com/menu" },
    { status: 308, location: "https://qidaigo.com/?source=www" },
  ])("rejects a non-canonical WWW redirect", ({ status, location }) => {
    expect(isExpectedCanonicalRedirect({
      status,
      location,
      sourceUrl: "https://www.qidaigo.com/",
      canonicalUrl: "https://qidaigo.com/",
    })).toBe(false);
  });

  it("rejects an all-HTTP canonical redirect configuration", () => {
    expect(isExpectedCanonicalRedirect({
      status: 308,
      location: "http://qidaigo.com/",
      sourceUrl: "http://www.qidaigo.com/",
      canonicalUrl: "http://qidaigo.com/",
    })).toBe(false);
  });
});
