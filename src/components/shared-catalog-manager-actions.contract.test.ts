import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./shared-catalog-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("shared catalog compact action hierarchy", () => {
  it("uses one ellipsis trigger and a centered accessible dialog for each catalog level", () => {
    expect(source).toContain("<MoreHorizontal");
    expect(source).toContain("setTaxonomyAction({ kind: \"CATEGORY\"");
    expect(source).toContain("setTaxonomyAction({ kind: \"GROUP\"");
    expect(source).toContain("<CatalogActionDialog");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("min-h-24");
  });

  it("removes stall assignment controls and labels in single-stall mode", () => {
    expect(source).toContain('operatingMode: "SINGLE_STALL" | "MULTI_STALL"');
    expect(source).toContain("!singleStallMode ? <CatalogActionButton");
    expect(source).toContain("!singleStallMode && assignmentProduct");
    expect(source).toContain('singleStallMode ? "" : ` · ${label("已分派")}');
  });

  it("prepares large images before upload and shows the complete saved preview", () => {
    expect(source).toContain("prepareProductImageForUpload(file)");
    expect(source).toContain("response.status === 413");
    expect(source).toContain("min-h-48 max-h-72");
    expect(source).toContain("object-contain");
    expect(source).not.toContain("h-36 w-full object-cover");
  });
});
