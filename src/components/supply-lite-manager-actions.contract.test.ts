import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./supply-lite-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");
const pageSource = readFileSync(
  fileURLToPath(new URL("../app/merchant/supply/page.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");
const moduleCatalogSource = readFileSync(
  fileURLToPath(new URL("../server/competitive-enhancements/module-catalog.ts", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("Supply Lite large action flow", () => {
  it("uses large action cards for every create or inventory workflow", () => {
    expect(source).toContain("SupplyActionCard");
    expect(source).toContain('testId="open-supply-ingredient"');
    expect(source).toContain('testId="open-supply-supplier"');
    expect(source).toContain('testId="open-supply-location"');
    expect(source).toContain('testId="open-supply-movement"');
    expect(source).toContain('testId="open-supply-recipe"');
    expect(source).toContain('testId="open-supply-purchase"');
  });

  it("opens each workflow in one touch-friendly modal instead of rendering long forms inline", () => {
    expect(source).toContain("SupplyActionDialog");
    expect(source).toContain('data-testid="supply-action-dialog"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('hidden={activeAction !== "ingredient"}');
    expect(source).toContain('hidden={activeAction !== "purchase"}');
  });

  it("uses a large switch for expiry tracking", () => {
    expect(source).toContain("LargeToggleField");
    expect(source).toContain('role="switch"');
    expect(source).toContain('aria-checked={checked}');
    expect(source).not.toContain('type="checkbox"');
  });

  it("offers one-touch item-code suggestions without bypassing save validation", () => {
    expect(source).toContain("suggestSupplyItemCode");
    expect(source).toContain('data-testid="suggest-supply-item-code"');
    expect(source).toContain("智慧產生代碼");
    expect(source).toContain("儲存時仍會檢查是否重複");
  });

  it("uses the merchant-facing Chinese module name", () => {
    expect(pageSource).toContain("原料與庫存管理");
    expect(pageSource).not.toContain("Supply Lite");
    expect(moduleCatalogSource).toContain('label: "原料與庫存管理"');
  });

  it("opens a management overlay from each editable item card", () => {
    expect(source).toContain("openRecordDialog");
    expect(source).toContain("SupplyRecordDialog");
    expect(source).toContain('data-testid="supply-record-dialog"');
    expect(source).toContain("manage-supply-ingredient-");
    expect(source).toContain("manage-supply-supplier-");
    expect(source).toContain("manage-supply-location-");
    expect(source).toContain("manage-supply-recipe-");
    expect(source).toContain("openEditAction");
    expect(source).toContain("openDeleteDialog");
    expect(source).toContain('data-testid="supply-delete-dialog"');
    expect(source).not.toContain("function ManagementActions");
  });

  it("keeps posted movements and purchase receipts immutable", () => {
    expect(source).toContain("已入帳紀錄不可直接修改或刪除");
  });
});
