import { describe, expect, it } from "vitest";
import {
  calculateUsageWarningLevels,
  canContinueOrderDuringSuspension,
  EntitlementError,
  entitlementErrorFromUnknown,
  evaluateCountLimit,
  evaluateSubscriptionUsability,
  orderPackageSize,
} from "@/server/billing/entitlement-service";

describe("EntitlementService policy helpers", () => {
  it.each(["ACTIVE", "PAST_DUE", "GRACE_PERIOD"])(
    "allows usable paid status %s",
    (status) => {
      expect(evaluateSubscriptionUsability({ status, trialEndsAt: null })).toBeNull();
    },
  );

  it("allows an unexpired trial", () => {
    expect(evaluateSubscriptionUsability({
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + 60_000),
    })).toBeNull();
  });

  it("rejects an expired trial", () => {
    expect(evaluateSubscriptionUsability({
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() - 1),
    })).toBe("TRIAL_EXPIRED");
  });

  it("distinguishes suspended and inactive subscriptions", () => {
    expect(evaluateSubscriptionUsability({ status: "SUSPENDED", trialEndsAt: null }))
      .toBe("SUBSCRIPTION_SUSPENDED");
    expect(evaluateSubscriptionUsability({ status: "CANCELLED", trialEndsAt: null }))
      .toBe("SUBSCRIPTION_NOT_ACTIVE");
  });

  it("enforces finite count limits and preserves unlimited limits", () => {
    expect(evaluateCountLimit(6, 5)).toBe("PLAN_LIMIT_REACHED");
    expect(evaluateCountLimit(5, 5)).toBeNull();
    expect(evaluateCountLimit(100_000, null)).toBeNull();
  });

  it("returns every crossed paid usage threshold", () => {
    expect(calculateUsageWarningLevels(79, 100)).toEqual([]);
    expect(calculateUsageWarningLevels(80, 100)).toEqual([80]);
    expect(calculateUsageWarningLevels(110, 100)).toEqual([80, 90, 100, 110]);
  });

  it("resolves only known order package sizes", () => {
    expect(orderPackageSize("ORDER_PACKAGE_LITE_100")).toBe(100);
    expect(orderPackageSize("ORDER_PACKAGE_STANDARD_500")).toBe(500);
    expect(orderPackageSize("ORDER_PACKAGE_PRO_1000")).toBe(1_000);
    expect(orderPackageSize("CUSTOM_SERVICE")).toBe(0);
  });

  it("allows only confirmed in-flight orders to continue while suspended", () => {
    expect(canContinueOrderDuringSuspension("CONFIRMED", "PREPARING")).toBe(true);
    expect(canContinueOrderDuringSuspension("PREPARING", "READY")).toBe(true);
    expect(canContinueOrderDuringSuspension("READY", "COMPLETED")).toBe(true);
    expect(canContinueOrderDuringSuspension("WAITING_CONFIRMATION", "CONFIRMED")).toBe(false);
    expect(canContinueOrderDuringSuspension("COMPLETED", "READY")).toBe(false);
  });

  it("maps database trigger errors to safe typed errors", () => {
    const mapped = entitlementErrorFromUnknown(
      new Error("database error P0001: ADDITIONAL_STALL_APPROVAL_REQUIRED"),
    );
    expect(mapped).toBeInstanceOf(EntitlementError);
    expect(mapped?.code).toBe("ADDITIONAL_STALL_APPROVAL_REQUIRED");
    expect(mapped?.message).not.toContain("P0001");
  });
});
