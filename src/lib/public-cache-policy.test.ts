import { describe, expect, it } from "vitest";
import { privateNoStoreHeaders, publicMenuResponseHeaders } from "./public-cache-policy";

describe("public cache policy", () => {
  it("uses short shared-cache headers for anonymous public menu reads", () => {
    expect(publicMenuResponseHeaders(new Request("https://example.test/menu"))).toEqual({
      "cache-control": "public, max-age=0, must-revalidate",
      "vercel-cdn-cache-control": "public, s-maxage=15, stale-while-revalidate=15",
      "cdn-cache-control": "public, s-maxage=10, stale-while-revalidate=10",
    });
  });

  it.each(["authorization", "cookie"])("bypasses shared caches when %s is present", (header) => {
    const request = new Request("https://example.test/menu", {
      headers: { [header]: "present" },
    });

    expect(publicMenuResponseHeaders(request)).toEqual(privateNoStoreHeaders());
  });

  it("keeps private responses out of every shared cache", () => {
    expect(privateNoStoreHeaders()).toEqual({
      "cache-control": "private, no-store, max-age=0",
    });
  });
});
