import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("product image runtime packaging", () => {
  it("traces Sharp and Linux libvips into merchant image functions", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain('"./node_modules/sharp/**/*"');
    expect(config).toContain('"./node_modules/@img/sharp-linux-x64/**/*"');
    expect(config).toContain('"./node_modules/@img/sharp-libvips-linux-x64/**/*"');
    expect(config).toContain('"/api/merchant/**/image"');
    expect(config).toContain('"/api/merchant/**/cover-image"');
  });

  it("loads Sharp inside the request-time processor boundary", () => {
    const processor = readFileSync(join(process.cwd(), "src/lib/product-image-processing.ts"), "utf8");
    expect(processor).not.toContain('import sharp from "sharp"');
    expect(processor).toContain('await import("sharp")');
    expect(processor).toContain("ProductImageProcessorUnavailableError");
  });
});
