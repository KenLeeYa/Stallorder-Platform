import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("merchant report layout", () => {
  it("arranges audit filters into two responsive rows", () => {
    const operations = source("./operations-console.tsx");

    expect(operations).toContain('className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"');
    expect(operations).toContain('className="text-xs font-semibold text-stone-600 sm:col-span-2"');
    expect(operations).toContain('className="mt-3 flex justify-end gap-2"');
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
});
