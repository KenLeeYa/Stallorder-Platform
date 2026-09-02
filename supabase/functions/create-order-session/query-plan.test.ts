import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8")
  .replaceAll("\r\n", "\n");

describe("create-order-session lightweight query plan", () => {
  it("runs menu queries only when the menu is requested", () => {
    const planStart = source.indexOf("const fullMenuQueries = parsed.data.includeMenu");
    const lightweightReturn = source.indexOf("if (!parsed.data.includeMenu)", planStart);
    const plan = source.slice(planStart, lightweightReturn);

    expect(planStart).toBeGreaterThan(-1);
    expect(lightweightReturn).toBeGreaterThan(planStart);
    expect(plan).toContain("parsed.data.includeMenu");
    expect(plan).toContain('admin.from("stalls")');
    expect(plan).toContain("ordering_settings:stall_ordering_settings(checkout_upsell_enabled, checkout_upsell_product_ids)");
    expect(plan).toContain('admin.from("stall_products")');
    expect(plan).toContain("), 2)");
    expect(plan).not.toContain('admin.from("stall_ordering_settings")');
    expect(plan).not.toContain('admin.from("qr_codes")');
    expect(plan).not.toContain('admin.from("dining_tables")');
  });

  it("keeps the baseline lightweight session path within the four-query golden budget", () => {
    const handlerStart = source.indexOf("Deno.serve");
    const planStart = source.indexOf("const fullMenuQueries = parsed.data.includeMenu");
    const lightweightReturn = source.indexOf("if (!parsed.data.includeMenu)");
    const baselinePath = source.slice(handlerStart, planStart);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(planStart).toBeGreaterThan(handlerStart);
    expect(lightweightReturn).toBeGreaterThan(handlerStart);
    expect(baselinePath.match(/timing\.measureDb/g)).toHaveLength(4);
    expect(4).toBeLessThanOrEqual(6);
  });

  it("runs canonical preflight before the unchanged session transaction", () => {
    const canonicalPreflight = source.indexOf(
      '"public_order_preflight_with_special_closure"',
    );
    const scheduleValidation = source.indexOf('admin.rpc("issue_idempotent_order_session_with_schedule_targeted"');
    const lightweightReturn = source.indexOf("if (!parsed.data.includeMenu)");
    const fullMenuBinding = source.indexOf("const [stallQuery, stallProductsQuery]", lightweightReturn);

    expect(canonicalPreflight).toBeGreaterThan(-1);
    expect(scheduleValidation).toBeGreaterThan(-1);
    expect(scheduleValidation).toBeGreaterThan(canonicalPreflight);
    expect(lightweightReturn).toBeGreaterThan(scheduleValidation);
    expect(fullMenuBinding).toBeGreaterThan(lightweightReturn);
    expect(source).not.toContain('admin.rpc("issue_idempotent_order_session_with_schedule",');
    expect(source).not.toContain('throw new HttpInputError("TABLE_UNAVAILABLE", 409)');
    expect(source).not.toContain('throw new HttpInputError("DELIVERY_UNAVAILABLE", 409)');
  });

  it("returns only fully translated QR catalog locales", () => {
    expect(source).toContain('admin.from("product_category_translations")');
    expect(source).toContain('admin.from("product_group_translations")');
    expect(source).toContain("categoryTranslations: product.categoryTranslations");
    expect(source).toContain("groupTranslations: product.groupTranslations");
    expect(source).toContain("supportedLocales: completeCatalogLocales(products, enabledLocales)");
  });

  it("returns checkout recommendations without adding a menu query", () => {
    expect(source).toContain("checkoutUpsell: {");
    expect(source).toContain("stallQuery.data.ordering_settings?.checkout_upsell_enabled === true");
    expect(source).toContain("stallQuery.data.ordering_settings?.checkout_upsell_product_ids");
  });

  it("returns sold-out products for display while keeping bundle components saleable-only", () => {
    expect(source).toContain("is_enabled, is_sold_out");
    expect(source).toContain("assignment.is_enabled || !product.is_active");
    expect(source).toContain("const isSoldOut = assignment?.is_sold_out === true || !product.is_active");
    expect(source).toContain("&& !assignment.is_sold_out");
  });
});
