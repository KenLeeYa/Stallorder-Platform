import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("platform admin billing presentation", () => {
  it("uses a compact responsive KPI dashboard", () => {
    const page = source("./billing/page.tsx");

    expect(page).toContain('data-testid="admin-billing-dashboard"');
    expect(page).toContain("grid-cols-2");
    expect(page).toContain("sm:grid-cols-3");
    expect(page).toContain("lg:grid-cols-5");
    expect(page).toContain("min-w-0 bg-white");
  });

  it("separates current PAYG offerings from preserved historical contracts", () => {
    const plans = source("./plans/page.tsx");
    const addOns = source("./add-ons/page.tsx");

    expect(plans).toContain('const currentPlanCodes = ["TRIAL", "PAYG", "ENTERPRISE"]');
    expect(plans).toContain('new Set(["LITE", "STANDARD", "PRO"])');
    expect(plans).toContain('m("Historical contracts")');
    expect(plans).toContain('plan.code === "PAYG"');
    expect(addOns).toContain('const legacyPrefixes = ["ADDITIONAL_STALL_", "ORDER_PACKAGE_"]');
    expect(addOns).toContain('m("Historical add-ons")');
  });
});
