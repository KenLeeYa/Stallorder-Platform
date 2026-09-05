import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./shared-catalog-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("shared catalog compact action hierarchy", () => {
  it("uses large accessible actions inside the catalog navigator for each catalog level", () => {
    expect(source).toContain("<MoreHorizontal");
    expect(source).toContain("setCatalogNavigatorAction({ kind: \"CATEGORY\"");
    expect(source).toContain("setCatalogNavigatorAction({ kind: \"GROUP\"");
    expect(source).toContain("<CatalogActionButton");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("min-h-24");
  });

  it("removes stall assignment controls and labels in single-stall mode", () => {
    expect(source).toContain('operatingMode: "SINGLE_STALL" | "MULTI_STALL"');
    expect(source).toContain("!singleStallMode ? <CatalogActionButton");
    expect(source).toContain("!singleStallMode && assignmentProduct");
    expect(source).toContain('!singleStallMode ? <span');
  });

  it("prepares large images before upload and shows the complete saved preview", () => {
    expect(source).toContain("prepareProductImageForUpload(file)");
    expect(source).toContain("response.status === 413");
    expect(source).toContain("min-h-48 max-h-72");
    expect(source).toContain("object-contain");
    expect(source).not.toContain("h-36 w-full object-cover");
  });

  it("opens the catalog through one large hierarchical dialog while keeping translations collapsible", () => {
    expect(source).toContain('data-testid="open-catalog-navigator"');
    expect(source).toContain('testId="catalog-navigator-dialog"');
    expect(source).toContain('type CatalogNavigatorLevel');
    expect(source).toContain('kind: "CATEGORIES"');
    expect(source).toContain('kind: "GROUPS"');
    expect(source).toContain('kind: "PRODUCTS"');
    expect(source).toContain('min-h-24');
    expect(source).toContain("<details");
    expect(source).toContain('label("商品翻譯")');
    expect(source).toContain('label("展開／收合")');
    expect(source).toContain("group-open:rotate-90");
    expect(source).not.toContain("<details key={category");
  });

  it("uses large touch switches instead of precision checkboxes in catalog workflows", () => {
    expect(source).toContain('role="switch"');
    expect(source).toContain('aria-checked={checked}');
    expect(source).toContain('min-h-14');
    expect(source).toContain("開啟後，員工結帳折扣");
    expect(source).not.toContain("可作為抽抽樂推薦／免費贈品");
    expect(source).not.toContain("取消勾選");
    expect(source).not.toContain('type="checkbox"');
  });
});
