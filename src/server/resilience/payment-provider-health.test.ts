import { describe, expect, it } from "vitest";
import {
  buildPaymentFallbackPlan,
  resolvePaymentProviderStatus,
} from "./payment-provider-health";

describe("payment provider health", () => {
  it("does not report a disabled provider as available", () => {
    expect(resolvePaymentProviderStatus(false, "AVAILABLE")).toBe("MAINTENANCE");
  });

  it("requires an explicit operational state after the provider flag is enabled", () => {
    expect(resolvePaymentProviderStatus(true, undefined)).toBe("UNKNOWN");
    expect(resolvePaymentProviderStatus(true, "available")).toBe("AVAILABLE");
    expect(resolvePaymentProviderStatus(true, "unexpected")).toBe("UNKNOWN");
  });

  it("keeps cash and manual payment available when both providers fail", () => {
    expect(buildPaymentFallbackPlan("UNAVAILABLE", "DEGRADED")).toEqual({
      onlineProviders: [],
      cashAllowed: true,
      manualPaymentAllowed: true,
    });
  });

  it("offers only providers that explicitly report available", () => {
    expect(buildPaymentFallbackPlan("AVAILABLE", "MAINTENANCE")).toEqual({
      onlineProviders: ["LINE_PAY"],
      cashAllowed: true,
      manualPaymentAllowed: true,
    });
  });
});
