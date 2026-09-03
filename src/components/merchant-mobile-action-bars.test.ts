import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(fileName: string) {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("merchant mobile action bars", () => {
  it("keeps shared catalog actions in one icon-only row through tablet widths", () => {
    const catalog = source("./shared-catalog-manager.tsx");

    expect(catalog).toContain('data-testid="shared-catalog-actions"');
    expect(catalog).toContain('data-testid="shared-catalog-action-scroller"');
    expect(catalog).toContain('data-testid="shared-catalog-tools"');
    expect(catalog).toContain('data-testid="shared-catalog-create-actions"');
    expect(catalog).toContain('className="hidden xl:inline"');
    expect(catalog).toContain("max-w-[calc(100vw-2rem)] overflow-x-hidden");
    expect(catalog).toContain("flex w-full min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1");
    expect(catalog).toContain("flex shrink-0 gap-2 xl:flex-wrap");
    expect(catalog).toContain("<FolderPlus");
    expect(catalog).toContain("<Layers3");
    expect(catalog).toContain("<PackagePlus");
  });

  it("keeps image preview URLs alive after development effect replay", () => {
    const catalog = source("./shared-catalog-manager.tsx");

    expect(catalog).toContain("const publishTimer = window.setTimeout(() => setObjectUrl(nextObjectUrl), 0)");
    expect(catalog).toContain("window.clearTimeout(publishTimer)");
    expect(catalog).toContain("URL.revokeObjectURL(nextObjectUrl)");
  });

  it("uses one responsive stall catalog with a small-screen dialog and independent desktop scrolling", () => {
    const products = source("./merchant-products.tsx");

    expect(products).toContain('aria-haspopup="dialog"');
    expect(products).toContain('role={catalogDialogOpen ? "dialog" : undefined}');
    expect(products).toContain("xl:h-full xl:overflow-y-auto xl:overscroll-contain");
    expect(products).toContain("min-h-0 flex-1 overflow-y-auto overscroll-contain");
    expect(products).toContain('data-testid="merchant-ordering-qr"');
    expect(products).toContain("mx-auto mt-5 w-full max-w-sm xl:mx-0");
  });

  it("shows the two large product-note entry buttons without the duplicate toolbar", () => {
    const notes = source("./product-note-groups-manager.tsx");

    expect(notes).toContain('data-testid="product-note-entry-actions"');
    expect(notes).toContain('data-testid="open-reusable-note-navigator"');
    expect(notes).toContain('data-testid="open-note-group-navigator"');
    expect(notes).toContain("mt-5 grid gap-3 md:grid-cols-2");
    expect(notes).not.toContain('data-testid="product-note-tools"');
  });
});
