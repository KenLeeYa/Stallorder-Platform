import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("multi-stall dashboard presentation", () => {
  it("uses the same compact card dashboard treatment as sales trends", () => {
    const dashboard = source("./multi-stall-dashboard.tsx");

    expect(dashboard).toContain('data-testid="multi-stall-summary-dashboard"');
    expect(dashboard).toContain("grid grid-cols-2 gap-2 sm:grid-cols-4");
    expect(dashboard).toContain("rounded-lg border border-stone-200 bg-white p-3 shadow-sm");
  });

  it("keeps dashboard filters in the URL for exact return navigation", () => {
    const dashboard = source("./multi-stall-dashboard.tsx");
    const page = source("../app/merchant/dashboard/page.tsx");

    expect(dashboard).toContain("window.history.replaceState");
    expect(dashboard).toContain('params.set("dateFrom", dateRange.dateFrom)');
    expect(dashboard).toContain('params.set("dashboardPreset", preset)');
    expect(page).toContain("dashboardDateRange");
    expect(page).toContain("initialPreset=");
  });
});
