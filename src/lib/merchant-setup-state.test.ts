import { describe, expect, it } from "vitest";
import { isMerchantSetupEffectivelyComplete } from "./merchant-setup-state";

describe("merchant setup completion compatibility", () => {
  it("accepts the canonical go-live flag", () => {
    expect(isMerchantSetupEffectivelyComplete({ goLiveCompleted: true })).toBe(true);
  });

  it("accepts durable completion evidence from an older activation", () => {
    expect(isMerchantSetupEffectivelyComplete({
      goLiveCompleted: false,
      goLiveCompletedAt: new Date("2026-08-01T00:00:00Z"),
    })).toBe(true);
    expect(isMerchantSetupEffectivelyComplete({
      goLiveCompleted: false,
      currentStep: 8,
      testOrderCompleted: true,
    })).toBe(true);
  });

  it("accepts an established merchant that already operated before setup tracking", () => {
    expect(isMerchantSetupEffectivelyComplete({
      goLiveCompleted: false,
      qrCode: { state: "ACTIVE" },
      stall: { orderingEnabled: false, orderingState: "CLOSED", nonTestOrderCount: 12 },
    })).toBe(true);
  });

  it("does not bypass a genuinely unfinished setup", () => {
    expect(isMerchantSetupEffectivelyComplete({
      goLiveCompleted: false,
      currentStep: 5,
      testOrderCompleted: false,
      qrCode: { state: "PAUSED" },
      stall: { orderingEnabled: false, orderingState: "CLOSED", nonTestOrderCount: 0 },
    })).toBe(false);
  });
});
