import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("merchant report layout", () => {
  it("arranges audit filters into the responsive mobile and tablet columns", () => {
    const operations = source("./operations-console.tsx");

    expect(operations).toContain('data-testid="operations-filter-grid"');
    expect(operations).toContain('className="grid grid-cols-2 gap-3 md:grid-cols-3"');
    expect(operations).toContain('data-testid="operations-filter-audit-query"');
    expect(operations).toContain('data-testid="operations-date-presets"');
    expect(operations).toContain('data-testid="operations-filter-actions"');
  });

  it("uses the cash-shift card treatment for report summary grids", () => {
    const overview = source("../app/merchant/reports/overview/page.tsx");
    const payments = source("../app/merchant/reports/payments/page.tsx");
    const stalls = source("../app/merchant/reports/stalls/page.tsx");

    for (const report of [overview, payments, stalls]) {
      expect(report).toContain("rounded-lg border border-stone-200 bg-white p-3 shadow-sm");
    }
    expect(stalls).not.toContain('data-testid="stall-performance-table"');
  });

  it("uses icon-only report navigation on phones and restores labels from tablet width", () => {
    const navigation = source("./report-navigation.tsx");

    expect(navigation).toContain('data-testid="report-navigation"');
    expect(navigation).toContain("flex w-full flex-nowrap");
    expect(navigation).toContain("overflow-x-auto");
    expect(navigation).toContain("min-w-11 flex-1");
    expect(navigation).toContain('className="sr-only md:not-sr-only"');
  });
});
