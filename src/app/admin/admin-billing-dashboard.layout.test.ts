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
    expect(page).toContain('className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5"');
    expect(page).toContain("min-w-0 rounded-lg border border-stone-200 bg-white p-3 shadow-sm");
    expect(page).not.toContain('data-testid="admin-billing-dashboard" className="mt-6 grid grid-cols-2 gap-px');
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
