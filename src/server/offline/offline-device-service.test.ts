import { describe, expect, it } from "vitest";
import { boundedOfflineRiskLimits } from "@/server/offline/offline-device-service";

describe("offline device risk limits", () => {
  const policy = {
    maxOfflineDurationMinutes: 240,
    maxPendingOrders: 40,
    maxTotalAmount: 20_000,
    maxSingleOrderAmount: 4_000,
  };

  it("uses reviewed policy limits for persistent storage", () => {
    expect(boundedOfflineRiskLimits(policy, "PERSISTENT", 180)).toEqual({
      maxOfflineDurationMinutes: 180,
      maxPendingOrders: 40,
      maxTotalAmount: 20_000,
      maxSingleOrderAmount: 4_000,
    });
  });

  it("reduces duration, queue and amount limits for best-effort storage", () => {
    expect(boundedOfflineRiskLimits(policy, "BEST_EFFORT", 180)).toEqual({
      maxOfflineDurationMinutes: 60,
      maxPendingOrders: 10,
      maxTotalAmount: 5_000,
      maxSingleOrderAmount: 1_000,
    });
  });
});
