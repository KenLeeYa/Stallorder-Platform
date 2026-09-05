import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("bounded historical data filters", () => {
  it("defaults cross-stall reports and operational records to today", () => {
    expect(source("src/lib/report-scope.ts")).toContain("const resolvedDateFrom = dateFrom ?? today;");
    const operationsPage = source("src/app/merchant/operations/page.tsx");
    expect(operationsPage).toContain("const dateFrom = single(params.dateFrom) ?? today;");
    expect(operationsPage).toContain("const dateTo = single(params.dateTo) ?? today;");
    expect(operationsPage).toContain("dashboardDateRange(dateFrom, dateTo)");
  });

  it("keeps the operations dates visible while reports retain the full shared preset set", () => {
    const consoleSource = source("src/components/operations-console.tsx");
    expect(consoleSource).toContain('applyPreset(preset: "day" | "week" | "month")');
    expect(consoleSource).not.toContain('inferOperationsDatePreset');
    expect(consoleSource).toContain('name="dateFrom"');
    expect(consoleSource).toContain('name="dateTo"');

    const reportSource = source("src/components/report-navigation.tsx");
    expect(reportSource).toContain('["TODAY", "YESTERDAY", "WEEK", "MONTH", "CUSTOM"]');
  });
});
