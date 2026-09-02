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
const migrationSource = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260902163000_checkout_upsell.sql", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("checkout upsell product ownership", () => {
  it("uses a per-product switch in stall product settings", () => {
    expect(catalogSource).toContain("checkoutUpsellSelected: boolean");
    expect(catalogSource).toContain('data-testid="stall-product-upsell-switch"');
    expect(catalogSource).toContain("checkoutUpsellSelected: product.checkoutUpsellSelected");
  });

  it("keeps the module page focused on enabling the feature, without a duplicate picker", () => {
    expect(modulesSource).toContain('label("請到攤位商品設定選擇推薦商品。")');
    expect(modulesSource).not.toContain("setCheckoutUpsellProduct(product.id");
  });

  it("keeps the checkout upsell schema change additive", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
  });
});
