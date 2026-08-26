import { describe, expect, it } from "vitest";
import { calculateAdvancedKpis } from "@/server/analytics/advanced-analytics";

describe("advanced analytics KPI calculations", () => {
  it("uses completed orders for average order value and all orders for rates", () => {
    expect(calculateAdvancedKpis([
      { orderCount: 10, completedOrderCount: 8, cancelledOrderCount: 1, netSales: 2400, grossSales: 3000, discountAmount: 600 },
      { orderCount: 5, completedOrderCount: 4, cancelledOrderCount: 1, netSales: 1200, grossSales: 1500, discountAmount: 300 },
    ])).toEqual({
      orderEntryAmount: 3600,
      orderCount: 15,
      completedOrderCount: 12,
      averageOrderValue: 300,
      cancellationRate: 2 / 15,
      discountRate: 900 / 4500,
    });
  });

  it("returns zero rates for an empty period", () => {
    expect(calculateAdvancedKpis([])).toMatchObject({ averageOrderValue: 0, cancellationRate: 0, discountRate: 0 });
  });
});
