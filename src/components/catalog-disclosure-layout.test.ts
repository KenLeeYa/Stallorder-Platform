import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("catalog hierarchy layout", () => {
  it("opens the product catalog as a large hierarchical dialog", () => {
    const catalog = source("./shared-catalog-manager.tsx");

    expect(catalog).not.toContain('<details id="shared-product-catalog"');
    expect(catalog).toContain('id="shared-product-catalog"');
    expect(catalog).toContain('data-testid="open-catalog-navigator"');
    expect(catalog).toContain('kind: "CATEGORIES"');
    expect(catalog).toContain('kind: "GROUPS"');
    expect(catalog).toContain('kind: "PRODUCTS"');
    expect(catalog).toContain("<CatalogLevelCard");
    expect(catalog).toContain("<CatalogActionButton");
  });

  it("keeps menu versions as the last compact create-toolbar action", () => {
    const catalog = source("./shared-catalog-manager.tsx");
    const createToolbar = catalog.slice(
      catalog.indexOf('data-testid="shared-catalog-create-actions"'),
      catalog.indexOf("</div>", catalog.indexOf('data-testid="shared-catalog-create-actions"')),
    );

    expect(createToolbar).toMatch(/新增套餐[\s\S]*data-testid="catalog-versions-action"/);
    expect(createToolbar).toContain("inline-grid h-11 w-11");
  });

  it("opens note groups and their options in the same large-button hierarchy", () => {
    const notes = source("./product-note-groups-manager.tsx");

    expect(notes).toContain('data-testid="open-note-group-navigator"');
    expect(notes).toContain("<ProductNoteGroupCard");
    expect(notes).toContain("<ProductNoteOptionCard");
    expect(notes).toContain('data-testid="product-note-action-dialog"');
    expect(notes).not.toContain('data-testid="product-note-groups-toggle-all"');
  });
});
