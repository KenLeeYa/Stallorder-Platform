import "server-only";

import { logEvent } from "@/lib/audit";
import {
  resolveResilienceFeatureFlags,
  type ResilienceFeatureFlagCode,
  type ResilienceFlagState,
} from "@/server/resilience/feature-flag-service";

export const availabilityServiceStatuses = [
  "AVAILABLE",
  "DEGRADED",
  "UNAVAILABLE",
  "MAINTENANCE",
  "UNKNOWN",
] as const;

export type AvailabilityServiceStatus = (typeof availabilityServiceStatuses)[number];
export type ActiveBackend = "PRIMARY" | "DR";

export type AvailabilityConfig = {
  mode: "NORMAL_PRIMARY" | "NORMAL_DR" | "DEGRADED_SAFE";
  activeBackend: ActiveBackend;
  promotionEpoch: number;
  orderIntake: "EDGE_PRIMARY" | "DUAL";
  qrOrdering: AvailabilityServiceStatus;
  staffOnline: AvailabilityServiceStatus;
  offlinePos: AvailabilityServiceStatus;
  linePay: AvailabilityServiceStatus;
  jkoPay: AvailabilityServiceStatus;
  updatedAt: string;
};

const availabilityFlagCodes = [
  "DUAL_ORDER_INTAKE_ENABLED",
  "DR_FAILOVER_ENABLED",
  "OFFLINE_POS_ENABLED",
  "LINE_PAY_ENABLED",
  "JKOPAY_ENABLED",
  "EMERGENCY_QR_DEGRADED_MODE",
] as const satisfies readonly ResilienceFeatureFlagCode[];

type AvailabilityFlagMap = Record<(typeof availabilityFlagCodes)[number], ResilienceFlagState>;

function parsePromotionEpoch(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function buildAvailabilityConfig(
  flags: AvailabilityFlagMap,
  options: {
    requestedBackend?: string;
    promotionEpoch?: string;
    now?: Date;
  } = {},
): AvailabilityConfig {
  const requestedBackend = options.requestedBackend?.trim().toUpperCase() === "DR"
    ? "DR"
    : "PRIMARY";
  const drAllowed = flags.DR_FAILOVER_ENABLED.enabled;
  const activeBackend: ActiveBackend = requestedBackend === "DR" && drAllowed ? "DR" : "PRIMARY";
  const configurationMismatch = requestedBackend === "DR" && !drAllowed;

  return {
    mode: configurationMismatch
      ? "DEGRADED_SAFE"
      : activeBackend === "DR"
        ? "NORMAL_DR"
        : "NORMAL_PRIMARY",
    activeBackend,
    promotionEpoch: parsePromotionEpoch(options.promotionEpoch),
    orderIntake: flags.DUAL_ORDER_INTAKE_ENABLED.enabled ? "DUAL" : "EDGE_PRIMARY",
    qrOrdering: flags.EMERGENCY_QR_DEGRADED_MODE.enabled ? "DEGRADED" : "AVAILABLE",
    staffOnline: configurationMismatch ? "DEGRADED" : "AVAILABLE",
    offlinePos: flags.OFFLINE_POS_ENABLED.enabled ? "AVAILABLE" : "MAINTENANCE",
    linePay: flags.LINE_PAY_ENABLED.enabled ? "AVAILABLE" : "MAINTENANCE",
    jkoPay: flags.JKOPAY_ENABLED.enabled ? "AVAILABLE" : "MAINTENANCE",
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
}

function safeUnavailableConfig(now = new Date()): AvailabilityConfig {
  return {
    mode: "DEGRADED_SAFE",
    activeBackend: "PRIMARY",
    promotionEpoch: parsePromotionEpoch(process.env.PROMOTION_EPOCH),
    orderIntake: "EDGE_PRIMARY",
    qrOrdering: "UNAVAILABLE",
    staffOnline: "UNAVAILABLE",
    offlinePos: "UNAVAILABLE",
    linePay: "UNKNOWN",
    jkoPay: "UNKNOWN",
    updatedAt: now.toISOString(),
  };
}

export async function getAvailabilityConfig(
  requestId: string,
  context: { deviceId?: string } = {},
) {
  try {
    const flags = await resolveResilienceFeatureFlags(availabilityFlagCodes, {
      deviceId: context.deviceId,
      rolloutKey: context.deviceId,
    });
    return buildAvailabilityConfig(flags as AvailabilityFlagMap, {
      requestedBackend: process.env.BACKEND_ACTIVE_TARGET,
      promotionEpoch: process.env.PROMOTION_EPOCH,
    });
  } catch {
    logEvent("error", "AVAILABILITY_CONFIG_RESOLUTION_FAILED", { requestId });
    return safeUnavailableConfig();
  }
}
