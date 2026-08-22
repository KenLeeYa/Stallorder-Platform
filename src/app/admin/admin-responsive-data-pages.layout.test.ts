import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const responsiveViews = [
  ["admin-subscriptions", source("./subscriptions/page.tsx")],
  ["admin-invoices", source("./invoices/page.tsx")],
  ["admin-invoice-detail", source("./invoices/[invoiceId]/page.tsx")],
  ["admin-usage", source("./usage/page.tsx")],
  ["admin-plan-versions", source("./plan-versions/page.tsx")],
  ["admin-entitlements", source("./entitlements/page.tsx")],
  ["merchant-business-types", source("../../components/merchant-business-type-option-manager.tsx")],
] as const;

describe("admin data page responsive layouts", () => {
  it.each(responsiveViews)("renders %s as cards below md and a table from md", (testId, pageSource) => {
    const mobileStart = pageSource.indexOf(`data-testid="${testId}-mobile-list"`);
    const desktopStart = pageSource.indexOf(`data-testid="${testId}-desktop-table"`);

    expect(mobileStart).toBeGreaterThan(-1);
    expect(desktopStart).toBeGreaterThan(mobileStart);

    const mobileView = pageSource.slice(mobileStart, desktopStart);
    const desktopView = pageSource.slice(desktopStart);

    expect(mobileView).toContain("md:hidden");
    expect(mobileView).toContain("min-w-0");
    expect(mobileView).not.toContain("overflow-x-auto");
    expect(mobileView).not.toContain("min-w-[");
    expect(desktopView).toContain("hidden overflow-x-auto");
    expect(desktopView).toContain("md:block");
  });

  it("keeps mobile management controls touch friendly", () => {
    for (const testId of ["admin-subscriptions", "admin-invoices", "admin-usage", "merchant-business-types"] as const) {
      const pageSource = responsiveViews.find(([id]) => id === testId)?.[1] ?? "";
      const mobileView = pageSource.slice(
        pageSource.indexOf(`data-testid="${testId}-mobile-list"`),
        pageSource.indexOf(`data-testid="${testId}-desktop-table"`),
      );

      expect(mobileView).toContain("min-h-11");
    }
  });

  it("keeps desktop management controls touch friendly", () => {
    for (const testId of ["admin-subscriptions", "admin-invoices", "admin-usage", "merchant-business-types"] as const) {
      const pageSource = responsiveViews.find(([id]) => id === testId)?.[1] ?? "";
      const desktopView = pageSource.slice(pageSource.indexOf(`data-testid="${testId}-desktop-table"`));

      expect(desktopView).toContain("min-h-11");
    }
  });

  it("shows PAYG usage pricing without replacing fixed legacy pricing", () => {
    const pageSource = responsiveViews.find(([id]) => id === "admin-plan-versions")?.[1] ?? "";
    const mobileView = pageSource.slice(
      pageSource.indexOf('data-testid="admin-plan-versions-mobile-list"'),
      pageSource.indexOf('data-testid="admin-plan-versions-desktop-table"'),
    );

    expect(mobileView).toContain('version.pricingMode === "USAGE_PER_STALL_CAPPED"');
    expect(mobileView).toContain('m("Usage unit price")');
    expect(mobileView).toContain("version.usageUnitPrice");
    expect(mobileView).toContain('m("Per-stall monthly cap")');
    expect(mobileView).toContain("version.monthlyCapAmount");
    expect(mobileView).toContain('m("Monthly fee")');
    expect(mobileView).toContain("version.basePrice");
    expect(mobileView).toContain('m("Annual fee")');
    expect(mobileView).toContain("version.annualPrice");
  });

  it("keeps the existing effective entitlement version selection", () => {
    const pageSource = responsiveViews.find(([id]) => id === "admin-entitlements")?.[1] ?? "";

    expect(pageSource).toContain("const currentVersions = newestVersions(versions);");
    expect(pageSource).toContain("version.entitlements.find");
  });

  it("uses the shared Chinese entitlement labels throughout the platform catalog", () => {
    const entitlementSource = responsiveViews.find(([id]) => id === "admin-entitlements")?.[1] ?? "";
    const planSource = source("./plans/page.tsx");
    const addOnSource = source("./add-ons/page.tsx");

    expect(entitlementSource).toContain("featureLabel(feature)");
    expect(entitlementSource).toContain("planLabel(version.plan.code, version.displayName)");
    expect(entitlementSource).not.toContain('feature.replaceAll("_", " ")');
    expect(planSource).toContain("featureLabel(entitlement.featureCode)");
    expect(planSource).toContain("planLabel(plan.code, plan.displayName)");
    expect(planSource).toContain('m("Plan entitlements")');
    expect(addOnSource).toContain("featureLabel(item.featureCode)");
    expect(addOnSource).toContain("addOnLabel(item.code, item.displayName)");
  });
});
