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

  it("places search above presets and keeps presets left of apply on mobile", () => {
    expect(source).toContain('data-testid="operations-filter-audit-query"');
    expect(source).toContain('data-testid="operations-date-presets"');
    expect(source).toContain('data-testid="operations-filter-actions"');
    expect(source).toContain("col-start-1 row-start-5");
    expect(source).toContain("md:col-start-3 md:row-start-3");
  });
});
