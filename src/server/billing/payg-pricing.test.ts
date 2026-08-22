import { describe, expect, it } from "vitest";
import {
  calculatePaygOrganizationCharge,
  calculatePaygStallCharge,
  PAYG_MONTHLY_STALL_CAP,
} from "@/server/billing/payg-pricing";

describe("PAYG pricing", () => {
  it.each([
    [0, 0],
    [1, 1],
    [1_498, 1_498],
    [1_499, 1_499],
    [1_500, 1_499],
    [2_000, 1_499],
    [5_000, 1_499],
    [20_000, 1_499],
  ])("charges %i completed orders as TWD %i", (orders, expectedCharge) => {
    const charge = calculatePaygStallCharge({
      stallId: "stall-a",
      stallName: "A 攤",
      grossCompletedOrders: orders,
    });

    expect(charge.finalCharge).toBe(expectedCharge);
    expect(charge.capAmount).toBe(PAYG_MONTHLY_STALL_CAP);
    expect(charge.capSavings).toBe(Math.max(orders - expectedCharge, 0));
  });

  it("subtracts idempotent full-refund credits without allowing a negative billable count", () => {
    expect(calculatePaygStallCharge({
      stallId: "stall-a",
      stallName: "A 攤",
      grossCompletedOrders: 120,
      fullRefundCredits: 20,
    })).toMatchObject({ netBillableOrders: 100, finalCharge: 100 });

    expect(calculatePaygStallCharge({
      stallId: "stall-a",
      stallName: "A 攤",
      grossCompletedOrders: 1,
      fullRefundCredits: 2,
    })).toMatchObject({ netBillableOrders: 0, finalCharge: 0 });
  });

  it("caps each stall independently before summing the organization total", () => {
    const result = calculatePaygOrganizationCharge([
      { stallId: "stall-a", stallName: "A 攤", grossCompletedOrders: 2_000 },
      { stallId: "stall-b", stallName: "B 攤", grossCompletedOrders: 800 },
      { stallId: "stall-c", stallName: "C 攤", grossCompletedOrders: 0 },
    ]);

    expect(result.stalls.map((stall) => stall.finalCharge)).toEqual([1_499, 800, 0]);
    expect(result.totalCharge).toBe(2_299);
  });

  it("rejects duplicate stalls and unsafe values", () => {
    expect(() => calculatePaygOrganizationCharge([
      { stallId: "stall-a", stallName: "A 攤", grossCompletedOrders: 1 },
      { stallId: "stall-a", stallName: "A 攤", grossCompletedOrders: 1 },
    ])).toThrow("Duplicate PAYG stall");
    expect(() => calculatePaygStallCharge({
      stallId: "stall-a",
      stallName: "A 攤",
      grossCompletedOrders: -1,
    })).toThrow("grossCompletedOrders");
  });
});
