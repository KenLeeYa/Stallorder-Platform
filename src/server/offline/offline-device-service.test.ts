import { describe, expect, it, vi } from "vitest";
import { EntitlementError } from "@/server/billing/entitlement-service";
import {
  boundedOfflineRiskLimits,
  canIssueOfflinePrintPermit,
} from "@/server/offline/offline-device-service";

describe("offline device risk limits", () => {
  const policy = {
    maxOfflineDurationMinutes: 240,
    maxPendingOrders: 40,
    maxTotalAmount: 20_000,
    maxSingleOrderAmount: 4_000,
    maxManualPaymentAmount: 3_000,
    maxTotalManualPaymentAmount: 8_000,
    requireCustomerContactAboveAmount: 2_000,
    managerApprovalThreshold: 2_500,
  };

  it("uses reviewed policy limits for persistent storage", () => {
    expect(boundedOfflineRiskLimits(policy, "PERSISTENT", 180)).toEqual({
      maxOfflineDurationMinutes: 180,
      maxPendingOrders: 40,
      maxTotalAmount: 20_000,
      maxSingleOrderAmount: 4_000,
      maxManualPaymentAmount: 3_000,
      maxTotalManualPaymentAmount: 8_000,
      requireCustomerContactAboveAmount: 2_000,
      managerApprovalThreshold: 2_500,
    });
  });

  it("reduces duration, queue and amount limits for best-effort storage", () => {
    expect(boundedOfflineRiskLimits(policy, "BEST_EFFORT", 180)).toEqual({
      maxOfflineDurationMinutes: 60,
      maxPendingOrders: 10,
      maxTotalAmount: 5_000,
      maxSingleOrderAmount: 1_000,
      maxManualPaymentAmount: 1_000,
      maxTotalManualPaymentAmount: 3_000,
      requireCustomerContactAboveAmount: 1_000,
      managerApprovalThreshold: 1_000,
    });
  });
});

describe("offline printer permit entitlement", () => {
  it("includes printing only when both the module and entitlement are usable", async () => {
    const checker = { assertFeatureEnabled: vi.fn().mockResolvedValue({}) };

    await expect(canIssueOfflinePrintPermit(
      "organization-1",
      true,
      checker,
    )).resolves.toBe(true);
    expect(checker.assertFeatureEnabled).toHaveBeenCalledWith(
      "organization-1",
      "PRINTER_INTEGRATION",
    );
  });

  it.each([
    "FEATURE_NOT_INCLUDED",
    "SUBSCRIPTION_SUSPENDED",
  ] as const)("omits printing for %s", async (code) => {
    const checker = {
      assertFeatureEnabled: vi.fn().mockRejectedValue(new EntitlementError(code)),
    };

    await expect(canIssueOfflinePrintPermit(
      "organization-1",
      true,
      checker,
    )).resolves.toBe(false);
  });

  it("does not query billing when the merchant module is disabled", async () => {
    const checker = { assertFeatureEnabled: vi.fn() };

    await expect(canIssueOfflinePrintPermit(
      "organization-1",
      false,
      checker,
    )).resolves.toBe(false);
    expect(checker.assertFeatureEnabled).not.toHaveBeenCalled();
  });

  it("does not hide unexpected billing failures", async () => {
    const checker = {
      assertFeatureEnabled: vi.fn().mockRejectedValue(new Error("DATABASE_UNAVAILABLE")),
    };

    await expect(canIssueOfflinePrintPermit(
      "organization-1",
      true,
      checker,
    )).rejects.toThrow("DATABASE_UNAVAILABLE");
  });
});
