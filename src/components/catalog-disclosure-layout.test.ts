import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("catalog disclosure layout", () => {
  it("keeps the catalog visible and collapses individual product groups", () => {
    const catalog = source("./shared-catalog-manager.tsx");

    expect(catalog).not.toContain('<details id="shared-product-catalog"');
    expect(catalog).toContain('id="shared-product-catalog"');
    expect(catalog).toContain('data-testid="shared-product-group"');
    expect(catalog).toContain("collapsedGroupIds");
    expect(catalog).toContain("updateGroupDisclosure");
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

  it("places the group toggle in the tab row and only shows it for groups", () => {
    const notes = source("./product-note-groups-manager.tsx");

    expect(notes).toMatch(/role="tablist"[\s\S]*activeTab === "GROUPS"[\s\S]*data-testid="product-note-groups-toggle-all"[\s\S]*<\/div>\s*\{message/);
    expect(notes).not.toContain('<div className="mt-4 flex justify-end">');
  });
});
