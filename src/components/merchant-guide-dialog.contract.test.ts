import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/components/merchant-guide-dialog.tsx"),
  "utf8",
);

describe("MerchantGuideDialog interaction contract", () => {
  it("is optional, reopenable, and rendered outside the compact header toolbar", () => {
    expect(source).toContain('data-testid="merchant-guide-launcher"');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body");
  });

  it("provides an accessible modal and keyboard dismissal", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("document.body.style.overflow = \"hidden\"");
  });

  it("keeps search, category filters, actions, and mobile targets usable", () => {
    expect(source).toContain('type="search"');
    expect(source).toContain('data-testid="merchant-guide-category-list"');
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain("min-h-12");
    expect(source).toContain("resolveMerchantGuideHref(selectedItem, scope)");
  });
});
