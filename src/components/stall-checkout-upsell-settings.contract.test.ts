import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const catalogSource = readFileSync(
  fileURLToPath(new URL("./stall-catalog-settings.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");
const modulesSource = readFileSync(
  fileURLToPath(new URL("./stall-modules-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");
const sharedCatalogSource = readFileSync(
  fileURLToPath(new URL("./shared-catalog-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");
const migrationSource = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260902163000_checkout_upsell.sql", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("checkout upsell product ownership", () => {
  it("keeps the per-product switch inside a touch-friendly product dialog", () => {
    expect(catalogSource).toContain("checkoutUpsellSelected: boolean");
    expect(catalogSource).toContain('data-testid="stall-product-settings-trigger"');
    expect(catalogSource).toContain('data-testid="stall-product-settings-dialog"');
    expect(catalogSource).toContain('data-testid="stall-product-upsell-switch"');
    expect(catalogSource).toContain("min-h-16");
    expect(catalogSource).toContain("checkoutUpsellSelected: product.checkoutUpsellSelected");
  });

  it("keeps checkout upsell in shared product editing without the lottery switch", () => {
    expect(sharedCatalogSource).toContain("checkoutUpsellStallIds");
    expect(sharedCatalogSource).toContain('data-testid="shared-product-upsell-switch"');
    expect(sharedCatalogSource).not.toContain("可作為抽抽樂推薦／免費贈品");
    expect(sharedCatalogSource).toContain("<details");
    expect(sharedCatalogSource).toContain('label("商品翻譯")');
  });

  it("owns lottery naming and eligible products inside the lottery module", () => {
    expect(modulesSource).toContain("lotteryCampaignName");
    expect(modulesSource).toContain("lotteryProductIds");
    expect(modulesSource).toContain('data-testid="open-lottery-product-picker"');
    expect(modulesSource).toContain('data-testid="lottery-product-picker-switch"');
    expect(modulesSource).toContain("categoryName");
    expect(modulesSource).toContain("groupName");
  });

  it("keeps the module page focused on enabling the feature, without a duplicate picker", () => {
    expect(modulesSource).toContain('label("請到攤位商品設定選擇推薦商品。")');
    expect(modulesSource).not.toContain("setCheckoutUpsellProduct(product.id");
  });

  it("keeps the checkout upsell schema change additive", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
  });
});
