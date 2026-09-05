import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./operations-console.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("operations console responsive filter layout", () => {
  it("uses the requested two-column mobile and three-column tablet layout", () => {
    expect(source).toContain('data-testid="operations-filter-grid"');
    expect(source).toContain("grid-cols-2");
    expect(source).toContain("md:grid-cols-3");
    expect(source).toContain('data-testid="operations-filter-stall"');
    expect(source).toContain('data-testid="operations-filter-alert-status"');
    expect(source).toContain('data-testid="operations-filter-alert-severity"');
    expect(source).toContain('data-testid="operations-filter-date-from"');
    expect(source).toContain('data-testid="operations-filter-date-to"');
    expect(source).toContain('data-testid="operations-filter-audit-outcome"');
  });

  it("keeps the prior mobile and desktop date arrangement from the operations reference", () => {
    expect(source).toContain('data-testid="operations-filter-audit-query"');
    expect(source).toContain('data-testid="operations-date-presets"');
    expect(source).toContain('data-testid="operations-filter-actions"');
    expect(source).toContain("col-start-1 row-start-5 grid grid-cols-3");
    expect(source).toContain("md:col-start-3 md:row-start-3");
    expect(source).toContain("col-start-2 row-start-5 flex items-end justify-end");
    expect(source).toContain("md:col-start-3 md:row-start-4");
    expect(source).toContain('wrapperClassName="col-start-2 row-start-1 md:col-start-1 md:row-start-2"');
    expect(source).toContain('wrapperClassName="col-start-2 row-start-2 md:col-start-2 md:row-start-2"');
    expect(source).toContain('className="mt-1 h-11 min-w-0 w-full');
    expect(source).toContain('className="min-h-11 min-w-0 rounded-md');
    expect(source).toContain('className="grid h-11 w-11 shrink-0');
    expect(source).not.toContain("inferOperationsDatePreset(dateFrom, dateTo)");
  });
});
