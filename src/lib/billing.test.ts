import { describe, expect, it } from "vitest";
import { calculateBillingEstimate, evaluateStallCreation } from "./billing";

describe("evaluateStallCreation", () => {
  it("enforces subscription, plan limit, and additional-stall approval", () => {
    expect(evaluateStallCreation({ subscriptionStatus: "PAST_DUE", currentActiveStalls: 1, includedStalls: 1, maxStalls: 10, approvedAdditionalStalls: 1 }).code).toBe("SUBSCRIPTION_INACTIVE");
    expect(evaluateStallCreation({ subscriptionStatus: "ACTIVE", currentActiveStalls: 1, includedStalls: 1, maxStalls: 1, approvedAdditionalStalls: 2 }).code).toBe("PLAN_STALL_LIMIT");
    expect(evaluateStallCreation({ subscriptionStatus: "ACTIVE", currentActiveStalls: 1, includedStalls: 1, maxStalls: 10, approvedAdditionalStalls: 0 }).code).toBe("ADDITIONAL_STALL_APPROVAL_REQUIRED");
    expect(evaluateStallCreation({ subscriptionStatus: "ACTIVE", currentActiveStalls: 1, includedStalls: 1, maxStalls: 10, approvedAdditionalStalls: 1 }).allowed).toBe(true);
  });
});

describe("calculateBillingEstimate", () => {
  it("uses approval price snapshots without double counting stall or order usage", () => {
    expect(calculateBillingEstimate({
      basePrice: 699,
      activeStalls: 3,
      includedStalls: 1,
      defaultAdditionalStallPrice: 299,
      approvals: [{ quantity: 1, unitPrice: 249 }],
      orderCount: 1200,
      includedOrders: 1000,
      excessOrderPrice: 2,
    })).toEqual({
      basePrice: 699,
      activeStalls: 3,
      additionalStallCount: 2,
      unapprovedAdditionalStallCount: 1,
      additionalStallFee: 548,
      orderCount: 1200,
      excessOrderCount: 200,
      excessOrderFee: 400,
      estimatedTotal: 1647,
    });
  });
});
