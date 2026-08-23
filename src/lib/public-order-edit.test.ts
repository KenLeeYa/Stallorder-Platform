import { describe, expect, it } from "vitest";
import {
  getPublicOrderCancelFailure,
  getPublicOrderEditFailure,
  type PublicOrderEditEligibility,
} from "./public-order-edit";

function order(overrides: Partial<PublicOrderEditEligibility> = {}): PublicOrderEditEligibility {
  return {
    source: "QR_MENU",
    status: "WAITING_CONFIRMATION",
    paymentStatus: "UNPAID",
    payment: null,
    discountAmount: 0,
    discountOptionId: null,
    items: [{ status: "PENDING", productionTask: null }],
    printJobs: [],
    ...overrides,
  };
}

describe("public order self-service eligibility", () => {
  it("allows editing or cancelling an unpaid order before merchant confirmation", () => {
    expect(getPublicOrderEditFailure(order())).toBeNull();
    expect(getPublicOrderCancelFailure(order())).toBeNull();
  });

  it("allows a confirmed but unstarted order to return to confirmation after editing", () => {
    const confirmed = order({
      status: "CONFIRMED",
      items: [{ status: "PENDING", productionTask: { status: "PENDING" } }],
      printJobs: [{ status: "PENDING" }],
    });

    expect(getPublicOrderEditFailure(confirmed)).toBeNull();
    expect(getPublicOrderCancelFailure(confirmed)).toBe("ORDER_ALREADY_CONFIRMED");
  });

  it("blocks edits after production, printing, payment, or discounts have started", () => {
    expect(getPublicOrderEditFailure(order({ items: [{ status: "PREPARING", productionTask: { status: "PREPARING" } }] }))).toBe("ORDER_ALREADY_STARTED");
    expect(getPublicOrderEditFailure(order({ status: "CONFIRMED", printJobs: [{ status: "SUCCEEDED" }] }))).toBe("PRINT_ALREADY_STARTED");
    expect(getPublicOrderEditFailure(order({ paymentStatus: "PAID", payment: { id: "payment" } }))).toBe("PAYMENT_ALREADY_RECORDED");
    expect(getPublicOrderEditFailure(order({ discountAmount: 10 }))).toBe("DISCOUNT_ALREADY_APPLIED");
  });
});
