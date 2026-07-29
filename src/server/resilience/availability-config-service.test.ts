import { describe, expect, it } from "vitest";
import type {
  ResilienceFeatureFlagCode,
  ResilienceFlagState,
} from "./feature-flag-service";
import { buildAvailabilityConfig } from "./availability-config-service";

const availabilityCodes = [
  "DR_FAILOVER_ENABLED",
  "OFFLINE_POS_ENABLED",
  "LINE_PAY_ENABLED",
  "JKOPAY_ENABLED",
  "EMERGENCY_QR_DEGRADED_MODE",
] as const satisfies readonly ResilienceFeatureFlagCode[];

function flags(
  enabled: Partial<Record<(typeof availabilityCodes)[number], boolean>> = {},
) {
  return Object.fromEntries(availabilityCodes.map((code) => [
    code,
    {
      code,
      enabled: enabled[code] ?? false,
      source: "DEFAULT",
      overrideId: null,
      expiresAt: null,
    } satisfies ResilienceFlagState,
  ])) as Record<(typeof availabilityCodes)[number], ResilienceFlagState>;
}

describe("availability config", () => {
  it("defaults to Primary and keeps disabled modules in maintenance", () => {
    const result = buildAvailabilityConfig(flags(), {
      now: new Date("2026-07-29T00:00:00.000Z"),
    });

    expect(result).toEqual({
      mode: "NORMAL_PRIMARY",
      activeBackend: "PRIMARY",
      promotionEpoch: 1,
      qrOrdering: "AVAILABLE",
      staffOnline: "AVAILABLE",
      offlinePos: "MAINTENANCE",
      linePay: "MAINTENANCE",
      jkoPay: "MAINTENANCE",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
  });

  it("does not accept a DR target unless failover is enabled", () => {
    const result = buildAvailabilityConfig(flags(), {
      requestedBackend: "DR",
      promotionEpoch: "7",
    });

    expect(result).toMatchObject({
      mode: "DEGRADED_SAFE",
      activeBackend: "PRIMARY",
      promotionEpoch: 7,
      staffOnline: "DEGRADED",
    });
  });

  it("uses DR only when the failover flag is enabled", () => {
    const result = buildAvailabilityConfig(flags({
      DR_FAILOVER_ENABLED: true,
      OFFLINE_POS_ENABLED: true,
      LINE_PAY_ENABLED: true,
      JKOPAY_ENABLED: true,
    }), {
      requestedBackend: "DR",
      promotionEpoch: "8",
    });

    expect(result).toMatchObject({
      mode: "NORMAL_DR",
      activeBackend: "DR",
      promotionEpoch: 8,
      offlinePos: "AVAILABLE",
      linePay: "AVAILABLE",
      jkoPay: "AVAILABLE",
    });
  });

  it("reports emergency QR degraded mode without changing the active backend", () => {
    const result = buildAvailabilityConfig(flags({
      EMERGENCY_QR_DEGRADED_MODE: true,
    }));

    expect(result.activeBackend).toBe("PRIMARY");
    expect(result.qrOrdering).toBe("DEGRADED");
  });
});
