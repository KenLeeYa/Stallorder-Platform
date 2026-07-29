import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getOAuthMigrationReadiness } from "@/server/auth/oauth/migration-readiness";

export const resilienceFeatureFlagCodes = [
  "DUAL_ORDER_INTAKE_ENABLED",
  "DR_READ_ROUTING_ENABLED",
  "DR_FAILOVER_ENABLED",
  "OFFLINE_POS_ENABLED",
  "OFFLINE_SINGLE_DEVICE_ONLY",
  "OFFLINE_MANUAL_PAYMENT_ENABLED",
  "QR_DEGRADED_MENU_ENABLED",
  "LINE_PAY_ENABLED",
  "JKOPAY_ENABLED",
  "ROLLING_RELEASE_ENABLED",
  "LOCAL_EDGE_GATEWAY_ENABLED",
  "EMERGENCY_QR_DEGRADED_MODE",
  "OAUTH_IDENTITY_FOUNDATION_ENABLED",
  "OAUTH_GOOGLE_ENABLED",
  "OAUTH_LINE_ENABLED",
  "OAUTH_APPLE_ENABLED",
  "OAUTH_ONLY_LOGIN_UI_ENABLED",
  "OAUTH_IDENTITY_LINKING_ENABLED",
  "OAUTH_MOCK_PROVIDER_ENABLED",
  "DELIVERY_PLATFORM_FOUNDATION_ENABLED",
  "DELIVERY_PLATFORM_UI_ENABLED",
  "DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED",
  "DELIVERY_PROVIDER_ACTIONS_ENABLED",
  "DELIVERY_MENU_SYNC_ENABLED",
  "DELIVERY_MOCK_PROVIDER_ENABLED",
  "UBER_EATS_INTEGRATION_ENABLED",
  "UBER_EATS_OAUTH_ENABLED",
  "UBER_EATS_API_ENABLED",
  "FOODPANDA_INTEGRATION_ENABLED",
  "FOODPANDA_PARTNER_API_ENABLED",
  "FOODPANDA_WEBHOOK_ENABLED",
] as const;

export type ResilienceFeatureFlagCode = (typeof resilienceFeatureFlagCodes)[number];

export const resilienceFeatureFlagDefaults: Record<ResilienceFeatureFlagCode, boolean> = {
  DUAL_ORDER_INTAKE_ENABLED: false,
  DR_READ_ROUTING_ENABLED: false,
  DR_FAILOVER_ENABLED: false,
  OFFLINE_POS_ENABLED: false,
  OFFLINE_SINGLE_DEVICE_ONLY: true,
  OFFLINE_MANUAL_PAYMENT_ENABLED: false,
  QR_DEGRADED_MENU_ENABLED: false,
  LINE_PAY_ENABLED: false,
  JKOPAY_ENABLED: false,
  ROLLING_RELEASE_ENABLED: false,
  LOCAL_EDGE_GATEWAY_ENABLED: false,
  EMERGENCY_QR_DEGRADED_MODE: false,
  OAUTH_IDENTITY_FOUNDATION_ENABLED: false,
  OAUTH_GOOGLE_ENABLED: false,
  OAUTH_LINE_ENABLED: false,
  OAUTH_APPLE_ENABLED: false,
  OAUTH_ONLY_LOGIN_UI_ENABLED: false,
  OAUTH_IDENTITY_LINKING_ENABLED: false,
  OAUTH_MOCK_PROVIDER_ENABLED: false,
  DELIVERY_PLATFORM_FOUNDATION_ENABLED: false,
  DELIVERY_PLATFORM_UI_ENABLED: false,
  DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED: false,
  DELIVERY_PROVIDER_ACTIONS_ENABLED: false,
  DELIVERY_MENU_SYNC_ENABLED: false,
  DELIVERY_MOCK_PROVIDER_ENABLED: false,
  UBER_EATS_INTEGRATION_ENABLED: false,
  UBER_EATS_OAUTH_ENABLED: false,
  UBER_EATS_API_ENABLED: false,
  FOODPANDA_INTEGRATION_ENABLED: false,
  FOODPANDA_PARTNER_API_ENABLED: false,
  FOODPANDA_WEBHOOK_ENABLED: false,
};

export const resilienceFlagScopeTypes = [
  "GLOBAL",
  "ORGANIZATION",
  "STALL",
  "DEVICE",
  "PERCENTAGE",
] as const;

export type ResilienceFlagScopeType = (typeof resilienceFlagScopeTypes)[number];

const nullableUuid = z.string().uuid().nullable().default(null);
const nullablePercentage = z.number().int().min(0).max(100).nullable().default(null);
const nullableExpiry = z.string().datetime({ offset: true }).nullable().default(null);

export const resilienceFlagOverrideCommandSchema = z.object({
  scopeType: z.enum(resilienceFlagScopeTypes),
  organizationId: nullableUuid,
  stallId: nullableUuid,
  deviceId: nullableUuid,
  enabled: z.boolean(),
  rolloutPercentage: nullablePercentage,
  expiresAt: nullableExpiry,
  reason: z.string()
    .trim()
    .min(5, "請輸入至少 5 個字元的異動原因。")
    .max(500, "異動原因不可超過 500 個字元。")
    .transform((value) => value.replace(/[\r\n]+/g, " ")),
}).superRefine((value, context) => {
  const noTargets = !value.organizationId && !value.stallId && !value.deviceId;
  const invalid = (message: string) => context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
  });

  if (value.scopeType === "GLOBAL" && (!noTargets || value.rolloutPercentage !== null)) {
    invalid("全域旗標不可指定組織、攤位、裝置或發布比例。");
  }
  if (
    value.scopeType === "ORGANIZATION"
    && (!value.organizationId || value.stallId || value.deviceId || value.rolloutPercentage !== null)
  ) {
    invalid("組織旗標只能指定 organizationId。");
  }
  if (
    value.scopeType === "STALL"
    && (!value.organizationId || !value.stallId || value.deviceId || value.rolloutPercentage !== null)
  ) {
    invalid("攤位旗標必須指定 organizationId 與 stallId。");
  }
  if (
    value.scopeType === "DEVICE"
    && (!value.organizationId || !value.stallId || !value.deviceId || value.rolloutPercentage !== null)
  ) {
    invalid("裝置旗標必須指定 organizationId、stallId 與 deviceId。");
  }
  if (
    value.scopeType === "PERCENTAGE"
    && (!noTargets || value.rolloutPercentage === null)
  ) {
    invalid("比例發布只能指定 rolloutPercentage。");
  }
});

export type ResilienceFlagOverrideCommand = z.infer<typeof resilienceFlagOverrideCommandSchema>;

export type ResilienceFlagEvaluationContext = {
  organizationId?: string;
  stallId?: string;
  deviceId?: string;
  rolloutKey?: string;
};

type EvaluationOverride = {
  id: string;
  scopeType: string;
  organizationId: string | null;
  stallId: string | null;
  deviceId: string | null;
  enabled: boolean;
  rolloutPercentage: number | null;
  expiresAt: Date | null;
};

type EvaluationFlag = {
  code: string;
  defaultEnabled: boolean;
  overrides: EvaluationOverride[];
};

export type ResilienceFlagState = {
  code: ResilienceFeatureFlagCode;
  enabled: boolean;
  source: "DEFAULT" | ResilienceFlagScopeType;
  overrideId: string | null;
  expiresAt: string | null;
};

function percentageBucket(code: string, key: string) {
  const digest = createHash("sha256").update(`${code}:${key}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function evaluateResilienceFeatureFlag(
  flag: EvaluationFlag,
  context: ResilienceFlagEvaluationContext = {},
  now = new Date(),
): ResilienceFlagState {
  const code = flag.code as ResilienceFeatureFlagCode;
  const active = flag.overrides.filter((override) => (
    !override.expiresAt || override.expiresAt.getTime() > now.getTime()
  ));

  const exact = [
    context.deviceId
      ? active.find((override) => (
        override.scopeType === "DEVICE"
        && override.organizationId === context.organizationId
        && override.stallId === context.stallId
        && override.deviceId === context.deviceId
      ))
      : undefined,
    context.stallId
      ? active.find((override) => (
        override.scopeType === "STALL"
        && override.organizationId === context.organizationId
        && override.stallId === context.stallId
      ))
      : undefined,
    context.organizationId
      ? active.find((override) => (
        override.scopeType === "ORGANIZATION"
        && override.organizationId === context.organizationId
      ))
      : undefined,
    active.find((override) => override.scopeType === "GLOBAL"),
  ].find(Boolean);

  if (exact) {
    return {
      code,
      enabled: exact.enabled,
      source: exact.scopeType as ResilienceFlagScopeType,
      overrideId: exact.id,
      expiresAt: exact.expiresAt?.toISOString() ?? null,
    };
  }

  const rollout = active.find((override) => override.scopeType === "PERCENTAGE");
  const rolloutKey = context.rolloutKey
    ?? context.deviceId
    ?? context.stallId
    ?? context.organizationId;
  if (rollout && rolloutKey && rollout.rolloutPercentage !== null) {
    const included = percentageBucket(flag.code, rolloutKey) < rollout.rolloutPercentage;
    return {
      code,
      enabled: included ? rollout.enabled : flag.defaultEnabled,
      source: included ? "PERCENTAGE" : "DEFAULT",
      overrideId: included ? rollout.id : null,
      expiresAt: included ? rollout.expiresAt?.toISOString() ?? null : null,
    };
  }

  return {
    code,
    enabled: flag.defaultEnabled,
    source: "DEFAULT",
    overrideId: null,
    expiresAt: null,
  };
}

function fallbackState(code: ResilienceFeatureFlagCode): ResilienceFlagState {
  return {
    code,
    enabled: resilienceFeatureFlagDefaults[code],
    source: "DEFAULT",
    overrideId: null,
    expiresAt: null,
  };
}

export async function resolveResilienceFeatureFlags(
  codes: readonly ResilienceFeatureFlagCode[] = resilienceFeatureFlagCodes,
  context: ResilienceFlagEvaluationContext = {},
) {
  const flags = await prisma.resilienceFeatureFlag.findMany({
    where: { code: { in: [...codes] } },
    include: {
      overrides: {
        where: {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      },
    },
  });
  const byCode = new Map(flags.map((flag) => [flag.code, flag]));
  return Object.fromEntries(codes.map((code) => {
    const flag = byCode.get(code);
    return [code, flag ? evaluateResilienceFeatureFlag(flag, context) : fallbackState(code)];
  })) as Record<ResilienceFeatureFlagCode, ResilienceFlagState>;
}

export async function listResilienceFeatureFlagsForAdmin() {
  const flags = await prisma.resilienceFeatureFlag.findMany({
    orderBy: { code: "asc" },
    include: {
      overrides: {
        orderBy: [
          { scopeType: "asc" },
          { updatedAt: "desc" },
        ],
      },
    },
  });

  return flags.map((flag) => ({
    id: flag.id,
    code: flag.code,
    description: flag.description,
    defaultEnabled: flag.defaultEnabled,
    isEmergency: flag.isEmergency,
    overrides: flag.overrides.map((override) => ({
      id: override.id,
      scopeType: override.scopeType,
      organizationId: override.organizationId,
      stallId: override.stallId,
      deviceId: override.deviceId,
      enabled: override.enabled,
      rolloutPercentage: override.rolloutPercentage,
      expiresAt: override.expiresAt?.toISOString() ?? null,
      reason: override.reason,
      createdAt: override.createdAt.toISOString(),
      updatedAt: override.updatedAt.toISOString(),
    })),
  }));
}

type FeatureFlagActor = {
  profileId: string;
  requestId: string;
  ipHash: string;
};

function auditSnapshot(override: {
  id: string;
  scopeType: string;
  organizationId: string | null;
  stallId: string | null;
  deviceId: string | null;
  enabled: boolean;
  rolloutPercentage: number | null;
  expiresAt: Date | null;
  reason: string;
}): Prisma.InputJsonObject {
  return {
    id: override.id,
    scopeType: override.scopeType,
    organizationId: override.organizationId,
    stallId: override.stallId,
    deviceId: override.deviceId,
    enabled: override.enabled,
    rolloutPercentage: override.rolloutPercentage,
    expiresAt: override.expiresAt?.toISOString() ?? null,
    reason: override.reason,
  };
}

async function assertScopeExists(command: ResilienceFlagOverrideCommand) {
  if (command.organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: command.organizationId },
      select: { id: true },
    });
    if (!organization) throw new Error("RESILIENCE_FLAG_ORGANIZATION_NOT_FOUND");
  }

  if (command.stallId) {
    const stall = await prisma.stall.findFirst({
      where: {
        id: command.stallId,
        organizationId: command.organizationId ?? undefined,
      },
      select: { id: true },
    });
    if (!stall) throw new Error("RESILIENCE_FLAG_STALL_SCOPE_MISMATCH");
  }
}

export async function setResilienceFeatureFlagOverride(
  code: ResilienceFeatureFlagCode,
  command: ResilienceFlagOverrideCommand,
  actor: FeatureFlagActor,
) {
  const flag = await prisma.resilienceFeatureFlag.findUnique({ where: { code } });
  if (!flag) throw new Error("RESILIENCE_FLAG_NOT_FOUND");
  if (code === "LOCAL_EDGE_GATEWAY_ENABLED" && command.enabled) {
    throw new Error("RESILIENCE_FUTURE_FLAG_LOCKED");
  }
  if (code === "OAUTH_ONLY_LOGIN_UI_ENABLED" && command.enabled) {
    const readiness = await getOAuthMigrationReadiness();
    if (!readiness.readyForOAuthOnly) throw new Error("OAUTH_MIGRATION_GATE_BLOCKED");
  }

  const now = new Date();
  const expiresAt = command.expiresAt ? new Date(command.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    throw new Error("RESILIENCE_FLAG_EXPIRY_NOT_FUTURE");
  }
  if (flag.isEmergency) {
    if (!expiresAt) throw new Error("RESILIENCE_EMERGENCY_EXPIRY_REQUIRED");
    if (expiresAt.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
      throw new Error("RESILIENCE_EMERGENCY_EXPIRY_TOO_LONG");
    }
  }

  await assertScopeExists(command);

  const result = await prisma.$transaction(async (transaction) => {
    const where = {
      flagId: flag.id,
      scopeType: command.scopeType,
      organizationId: command.organizationId,
      stallId: command.stallId,
      deviceId: command.deviceId,
    };
    const existing = await transaction.resilienceFeatureFlagOverride.findFirst({ where });
    const data = {
      enabled: command.enabled,
      rolloutPercentage: command.rolloutPercentage,
      expiresAt,
      reason: command.reason,
      updatedByProfileId: actor.profileId,
    };
    const override = existing
      ? await transaction.resilienceFeatureFlagOverride.update({
        where: { id: existing.id },
        data,
      })
      : await transaction.resilienceFeatureFlagOverride.create({
        data: {
          ...where,
          ...data,
          createdByProfileId: actor.profileId,
        },
      });

    await transaction.auditLog.create({
      data: {
        organizationId: command.organizationId,
        stallId: command.stallId,
        actorProfileId: actor.profileId,
        action: flag.isEmergency
          ? "RESILIENCE_EMERGENCY_FLAG_CHANGED"
          : "RESILIENCE_FEATURE_FLAG_CHANGED",
        entityType: "RESILIENCE_FEATURE_FLAG_OVERRIDE",
        entityId: override.id,
        outcome: "SUCCESS",
        requestId: actor.requestId,
        ipHash: actor.ipHash,
        metadata: JSON.stringify({
          severity: flag.isEmergency ? "HIGH" : "INFO",
          code,
          scopeType: command.scopeType,
        }),
        beforeJson: existing ? auditSnapshot(existing) : undefined,
        afterJson: auditSnapshot(override),
      },
    });

    return override;
  });

  logEvent(flag.isEmergency ? "warn" : "info", "RESILIENCE_FEATURE_FLAG_CHANGED", {
    requestId: actor.requestId,
    code,
    scopeType: command.scopeType,
    enabled: command.enabled,
    emergency: flag.isEmergency,
  });

  return {
    ...auditSnapshot(result),
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
