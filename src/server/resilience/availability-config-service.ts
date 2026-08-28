import "server-only";

import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  resolveResilienceFeatureFlags,
  type ResilienceFeatureFlagCode,
  type ResilienceFlagState,
} from "@/server/resilience/feature-flag-service";
import { resolvePaymentProviderStatus } from "@/server/resilience/payment-provider-health";

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

type BackendRuntimeSnapshot = {
  backendRole: string;
  writesEnabled: boolean;
  enforcementEnabled: boolean;
} | null;

const RUNTIME_SNAPSHOT_TTL_MS = 2_000;
let runtimeSnapshotCache: {
  expiresAt: number;
  value?: BackendRuntimeSnapshot;
  pending?: Promise<BackendRuntimeSnapshot>;
} | null = null;

function parsePromotionEpoch(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function buildAvailabilityConfig(
  flags: AvailabilityFlagMap,
  options: {
    requestedBackend?: string;
    promotionEpoch?: string;
    backendWritable?: boolean;
    linePayStatus?: string;
    jkoPayStatus?: string;
    now?: Date;
  } = {},
): AvailabilityConfig {
  const requestedBackend = options.requestedBackend?.trim().toUpperCase() === "DR"
    ? "DR"
    : "PRIMARY";
  const drAllowed = flags.DR_FAILOVER_ENABLED.enabled;
  const activeBackend: ActiveBackend = requestedBackend === "DR" && drAllowed ? "DR" : "PRIMARY";
  const configurationMismatch = requestedBackend === "DR" && !drAllowed;
  const backendUnavailable = options.backendWritable === false;

  return {
    mode: configurationMismatch || backendUnavailable
      ? "DEGRADED_SAFE"
      : activeBackend === "DR"
        ? "NORMAL_DR"
        : "NORMAL_PRIMARY",
    activeBackend,
    promotionEpoch: parsePromotionEpoch(options.promotionEpoch),
    orderIntake: flags.DUAL_ORDER_INTAKE_ENABLED.enabled ? "DUAL" : "EDGE_PRIMARY",
    qrOrdering: backendUnavailable
      ? "UNAVAILABLE"
      : flags.EMERGENCY_QR_DEGRADED_MODE.enabled ? "DEGRADED" : "AVAILABLE",
    staffOnline: configurationMismatch || backendUnavailable ? "DEGRADED" : "AVAILABLE",
    offlinePos: flags.OFFLINE_POS_ENABLED.enabled ? "AVAILABLE" : "MAINTENANCE",
    linePay: resolvePaymentProviderStatus(
      flags.LINE_PAY_ENABLED.enabled,
      options.linePayStatus,
    ),
    jkoPay: resolvePaymentProviderStatus(
      flags.JKOPAY_ENABLED.enabled,
      options.jkoPayStatus,
    ),
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
    const [flags, runtime] = await Promise.all([
      resolveResilienceFeatureFlags(availabilityFlagCodes, {
        deviceId: context.deviceId,
        rolloutKey: context.deviceId,
      }),
      getBackendRuntimeSnapshot(),
    ]);
    const backendWritable = Boolean(runtime) && (
      !runtime?.enforcementEnabled
      || (runtime.backendRole === "ACTIVE_WRITER" && runtime.writesEnabled)
    );
    return buildAvailabilityConfig(flags as AvailabilityFlagMap, {
      requestedBackend: process.env.BACKEND_ACTIVE_TARGET,
      promotionEpoch: process.env.PROMOTION_EPOCH,
      backendWritable,
      linePayStatus: process.env.LINE_PAY_OPERATIONAL_STATUS,
      jkoPayStatus: process.env.JKOPAY_OPERATIONAL_STATUS,
    });
  } catch {
    logEvent("error", "AVAILABILITY_CONFIG_RESOLUTION_FAILED", { requestId });
    return safeUnavailableConfig();
  }
}

async function getBackendRuntimeSnapshot(): Promise<BackendRuntimeSnapshot> {
  const now = Date.now();
  if (runtimeSnapshotCache?.value !== undefined && runtimeSnapshotCache.expiresAt > now) {
    return runtimeSnapshotCache.value;
  }
  if (runtimeSnapshotCache?.pending) return runtimeSnapshotCache.pending;

  const pending = prisma.backendRuntimeState.findFirst({
    where: { isCurrent: true },
    select: {
      backendRole: true,
      writesEnabled: true,
      enforcementEnabled: true,
    },
  });
  runtimeSnapshotCache = { expiresAt: now + RUNTIME_SNAPSHOT_TTL_MS, pending };
  try {
    const value = await pending;
    runtimeSnapshotCache = { expiresAt: Date.now() + RUNTIME_SNAPSHOT_TTL_MS, value };
    return value;
  } catch (error) {
    runtimeSnapshotCache = null;
    throw error;
  }
}
