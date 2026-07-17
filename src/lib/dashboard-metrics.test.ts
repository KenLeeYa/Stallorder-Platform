import { describe, expect, it } from "vitest";
import { aggregateDailyMetrics } from "./dashboard-metrics";
import { dashboardDateRange } from "./dashboard-validation";

describe("aggregateDailyMetrics", () => {
  it("aggregates organization totals without averaging stall averages", () => {
    const result = aggregateDailyMetrics([
      { businessDate: new Date("2026-07-12"), orderCount: 4, completedOrderCount: 2, cancelledOrderCount: 1, pendingOrderCount: 1, unpaidOrderCount: 1, netSales: 500, cashAmount: 400, manualTransferAmount: 100, otherPaymentAmount: 0, lastOrderAt: new Date("2026-07-12T10:00:00Z") },
      { businessDate: new Date("2026-07-13"), orderCount: 2, completedOrderCount: 1, cancelledOrderCount: 0, pendingOrderCount: 1, unpaidOrderCount: 0, netSales: 400, cashAmount: 400, manualTransferAmount: 0, otherPaymentAmount: 0, lastOrderAt: new Date("2026-07-13T11:00:00Z") },
    ]);
    expect(result.totalSales).toBe(900);
    expect(result.averageOrderValue).toBe(300);
    expect(result.cancellationRate).toBeCloseTo(1 / 6);
    expect(result.lastOrderAt?.toISOString()).toBe("2026-07-13T11:00:00.000Z");
  });
});

describe("dashboardDateRange", () => {
  it("accepts bounded ranges and rejects reversed or excessive ranges", () => {
    expect(dashboardDateRange("2026-07-01", "2026-07-31").ok).toBe(true);
    expect(dashboardDateRange("2026-07-31", "2026-07-01").ok).toBe(false);
    expect(dashboardDateRange("2026-01-01", "2026-07-01").ok).toBe(false);
  });

  it("rejects invalid calendar dates", () => {
    expect(dashboardDateRange("2026-02-29", "2026-03-01").ok).toBe(false);
    expect(dashboardDateRange("2026-07-01", "2026-13-01").ok).toBe(false);
    expect(dashboardDateRange("not-a-date", "2026-07-01").ok).toBe(false);
  });
});
