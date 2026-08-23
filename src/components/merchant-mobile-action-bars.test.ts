import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(fileName: string) {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("merchant mobile action bars", () => {
  it("keeps shared catalog actions icon-only on mobile with visible desktop labels", () => {
    const catalog = source("./shared-catalog-manager.tsx");

    expect(catalog).toContain('data-testid="shared-catalog-tools"');
    expect(catalog).toContain('data-testid="shared-catalog-create-actions"');
    expect(catalog).toContain('className="sr-only sm:not-sr-only"');
    expect(catalog).toContain("flex-nowrap gap-2 overflow-x-auto");
    expect(catalog).toContain("<FolderPlus");
    expect(catalog).toContain("<Layers3");
    expect(catalog).toContain("<PackagePlus");
  });

  it("keeps product-note action controls icon-only on mobile", () => {
    const notes = source("./product-note-groups-manager.tsx");

    expect(notes).toContain('data-testid="product-note-tools"');
    expect(notes).toContain('className="sr-only sm:not-sr-only"');
    expect(notes).toContain("flex-nowrap gap-2 overflow-x-auto");
  });
});
