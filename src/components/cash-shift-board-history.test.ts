import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./cash-shift-board.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("CashShiftBoard history filters", () => {
  it("provides day, week, month, date-range, and five-row pagination controls", () => {
    expect(source).toContain('data-testid="cash-history-filters"');
    expect(source).toContain('data-testid="cash-history-date-from"');
    expect(source).toContain('data-testid="cash-history-date-to"');
    expect(source).toContain('applyHistoryPreset("DAY")');
    expect(source).toContain('applyHistoryPreset("WEEK")');
    expect(source).toContain('applyHistoryPreset("MONTH")');
    expect(source).toContain("useState<OperationsPageSize>(5)");
    expect(source).toContain("CashHistoryPageSizeSelect");
    expect(source).toContain("CashHistoryPageNavigation");
    expect(source).not.toContain("MerchantListPageSizeSelect");
    expect(source).not.toContain("MerchantListPageNavigation");
    expect(source).toContain("visibleHistory.map");
  });
});
