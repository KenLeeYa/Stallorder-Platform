import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./storefront-mode-nav.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("storefront sticky navigation", () => {
  it("publishes the live mode navigation height for the sticky category row", () => {
    expect(source).toContain('"use client"');
    expect(source).toContain("ResizeObserver");
    expect(source).toContain('setProperty("--storefront-mode-nav-height"');
    expect(source).toContain('removeProperty("--storefront-mode-nav-height")');
  });
});
