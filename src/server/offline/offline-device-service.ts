import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma, UserRole } from "@prisma/client";
import {
  type OfflineBootstrapCommand,
  type OfflineManagementCommand,
  type OfflineRuntimeLimits,
  type OfflineStorageClass,
  type OfflineWriteMode,
} from "@/offline/offline-contract";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/security";
import { createOrReuseOfflineMenuSnapshot } from "@/server/offline/offline-menu-snapshot-service";
import {
  requireOfflinePermitSigningSecret,
  signOfflinePermit,
  type OfflinePermitPayload,
} from "@/server/offline/offline-permit";
import {
  resolveResilienceFeatureFlags,
  type ResilienceFlagState,
} from "@/server/resilience/feature-flag-service";

const DEFAULT_LIMITS: OfflineRuntimeLimits = {
  maxOfflineDurationMinutes: 120,
  maxPendingOrders: 25,
  maxTotalAmount: 10_000,
  maxSingleOrderAmount: 2_000,
};

const PERMIT_ROLES = new Set<UserRole>([
  "PLATFORM_ADMIN",
  "ORGANIZATION_OWNER",
  "ORGANIZATION_ADMIN",
  "STALL_MANAGER",
  "STAFF",
]);

export class OfflineOperationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OfflineOperationError";
  }
}

type OfflineActor = {
  profileId: string;
  requestId: string;
  ipHash: string;
};

type RegisterDeviceInput = {
  organizationId: string;
  stallId: string;
  profileId: string;
  installationId: string;
  displayName: string;
  platform: string;
  appVersion: string;
  pwaInstalled: boolean;
  actor: OfflineActor;
};

type IssueBootstrapInput = {
  organizationId: string;
  stallId: string;
  profileId: string;
  roles: UserRole[];
  command: OfflineBootstrapCommand;
  actor: OfflineActor;
};

function jsonMetadata(value: Record<string, string | number | boolean | null>) {
  return JSON.stringify(value);
}

function deviceAuditSnapshot(device: {
  id: string;
  profileId: string;
  displayName: string;
  platform: string;
  appVersion: string;
  pwaInstalled: boolean;
  offlineEnabled: boolean;
  offlineRole: string;
  status: string;
  permitExpiresAt: Date | null;
  revokedAt: Date | null;
}): Prisma.InputJsonObject {
  return {
    id: device.id,
    profileId: device.profileId,
    displayName: device.displayName,
    platform: device.platform,
    appVersion: device.appVersion,
    pwaInstalled: device.pwaInstalled,
    offlineEnabled: device.offlineEnabled,
    offlineRole: device.offlineRole,
    status: device.status,
    permitExpiresAt: device.permitExpiresAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
  };
}

function policyAuditSnapshot(policy: {
  stallId: string;
  offlineEnabled: boolean;
  offlineWriteMode: string;
  offlineLeaderDeviceId: string | null;
  maxOfflineDurationMinutes: number;
  maxPendingOrders: number;
  maxTotalAmount: { toString(): string };
  maxSingleOrderAmount: { toString(): string };
}): Prisma.InputJsonObject {
  return {
    stallId: policy.stallId,
    offlineEnabled: policy.offlineEnabled,
    offlineWriteMode: policy.offlineWriteMode,
    offlineLeaderDeviceId: policy.offlineLeaderDeviceId,
    maxOfflineDurationMinutes: policy.maxOfflineDurationMinutes,
    maxPendingOrders: policy.maxPendingOrders,
    maxTotalAmount: policy.maxTotalAmount.toString(),
    maxSingleOrderAmount: policy.maxSingleOrderAmount.toString(),
  };
}

async function resolveOfflineFlags(
  organizationId: string,
  stallId: string,
  deviceId?: string,
) {
  return resolveResilienceFeatureFlags([
    "OFFLINE_POS_ENABLED",
    "OFFLINE_SINGLE_DEVICE_ONLY",
    "OFFLINE_MANUAL_PAYMENT_ENABLED",
  ], {
    organizationId,
    stallId,
    deviceId,
    rolloutKey: deviceId ?? stallId,
  });
}

function assertOfflinePosEnabled(flags: {
  OFFLINE_POS_ENABLED: ResilienceFlagState;
  OFFLINE_SINGLE_DEVICE_ONLY: ResilienceFlagState;
}) {
  if (!flags.OFFLINE_POS_ENABLED.enabled) {
    throw new OfflineOperationError("OFFLINE_POS_DISABLED");
  }
  if (!flags.OFFLINE_SINGLE_DEVICE_ONLY.enabled) {
    throw new OfflineOperationError("OFFLINE_SINGLE_DEVICE_POLICY_DISABLED");
  }
}

function safeDevice(device: {
  id: string;
  installationId: string;
  displayName: string;
  platform: string;
  appVersion: string;
  pwaInstalled: boolean;
  offlineEnabled: boolean;
  offlineRole: string;
  status: string;
  lastOnlineAt: Date | null;
  lastSyncAt: Date | null;
  permitExpiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: device.id,
    installationId: device.installationId,
    displayName: device.displayName,
    platform: device.platform,
    appVersion: device.appVersion,
    pwaInstalled: device.pwaInstalled,
    offlineEnabled: device.offlineEnabled,
    offlineRole: device.offlineRole,
    status: device.status,
    lastOnlineAt: device.lastOnlineAt?.toISOString() ?? null,
    lastSyncAt: device.lastSyncAt?.toISOString() ?? null,
    permitExpiresAt: device.permitExpiresAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}

export function boundedOfflineRiskLimits(
  policy: OfflineRuntimeLimits,
  storageClass: Extract<OfflineStorageClass, "PERSISTENT" | "BEST_EFFORT">,
  requestedDurationMinutes: number,
) {
  const bestEffort = storageClass === "BEST_EFFORT";
  return {
    maxOfflineDurationMinutes: Math.min(
      policy.maxOfflineDurationMinutes,
      requestedDurationMinutes,
      bestEffort ? 60 : 720,
    ),
    maxPendingOrders: Math.min(policy.maxPendingOrders, bestEffort ? 10 : 500),
    maxTotalAmount: Math.min(policy.maxTotalAmount, bestEffort ? 5_000 : 99_999_999.99),
    maxSingleOrderAmount: Math.min(
      policy.maxSingleOrderAmount,
      bestEffort ? 1_000 : 99_999_999.99,
    ),
  };
}

export async function registerOfflineDevice(input: RegisterDeviceInput) {
  const flags = await resolveOfflineFlags(input.organizationId, input.stallId);
  assertOfflinePosEnabled(flags);
  const existing = await prisma.clientDevice.findUnique({
    where: {
      organizationId_installationId: {
        organizationId: input.organizationId,
        installationId: input.installationId,
      },
    },
  });
  if (
    existing
    && (existing.stallId !== input.stallId || existing.profileId !== input.profileId)
  ) {
    throw new OfflineOperationError("OFFLINE_DEVICE_SCOPE_MISMATCH");
  }
  if (existing && ["REVOKED", "LOST", "REPLACED"].includes(existing.status)) {
    throw new OfflineOperationError("OFFLINE_DEVICE_REQUIRES_MANAGER_REVIEW");
  }

  const now = new Date();
  const device = await prisma.$transaction(async (transaction) => {
    if (existing) {
      return transaction.clientDevice.update({
        where: { id: existing.id },
        data: {
          displayName: input.displayName,
          platform: input.platform,
          appVersion: input.appVersion,
          pwaInstalled: input.pwaInstalled,
          lastOnlineAt: now,
        },
      });
    }

    const created = await transaction.clientDevice.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        profileId: input.profileId,
        installationId: input.installationId,
        displayName: input.displayName,
        platform: input.platform,
        appVersion: input.appVersion,
        pwaInstalled: input.pwaInstalled,
        lastOnlineAt: now,
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        actorProfileId: input.profileId,
        action: "OFFLINE_DEVICE_REGISTERED",
        entityType: "CLIENT_DEVICE",
        entityId: created.id,
        outcome: "SUCCESS",
        requestId: input.actor.requestId,
        ipHash: input.actor.ipHash,
        metadata: jsonMetadata({
          platform: created.platform,
          pwaInstalled: created.pwaInstalled,
          status: created.status,
        }),
        afterJson: deviceAuditSnapshot(created),
      },
    });
    return created;
  });

  return {
    device: safeDevice(device),
    approvalRequired: device.status !== "ACTIVE" || !device.offlineEnabled,
  };
}

export async function getOfflineManagementState(organizationId: string, stallId: string) {
  const [policy, devices, flags] = await Promise.all([
    prisma.offlineStallRuntimePolicy.findFirst({
      where: { organizationId, stallId },
    }),
    prisma.clientDevice.findMany({
      where: { organizationId, stallId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: {
        permits: {
          where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
          select: { expiresAt: true },
          take: 1,
        },
      },
    }),
    resolveOfflineFlags(organizationId, stallId),
  ]);

  return {
    feature: {
      offlinePos: flags.OFFLINE_POS_ENABLED,
      singleDeviceOnly: flags.OFFLINE_SINGLE_DEVICE_ONLY,
      manualPayment: flags.OFFLINE_MANUAL_PAYMENT_ENABLED,
    },
    policy: policy ? {
      stallId: policy.stallId,
      offlineEnabled: policy.offlineEnabled,
      offlineWriteMode: policy.offlineWriteMode,
      offlineLeaderDeviceId: policy.offlineLeaderDeviceId,
      maxOfflineDurationMinutes: policy.maxOfflineDurationMinutes,
      maxPendingOrders: policy.maxPendingOrders,
      maxTotalAmount: Number(policy.maxTotalAmount),
      maxSingleOrderAmount: Number(policy.maxSingleOrderAmount),
      updatedAt: policy.updatedAt.toISOString(),
    } : {
      stallId,
      offlineEnabled: false,
      offlineWriteMode: "DISABLED" as OfflineWriteMode,
      offlineLeaderDeviceId: null,
      ...DEFAULT_LIMITS,
      updatedAt: null,
    },
    devices: devices.map((device) => ({
      ...safeDevice(device),
      activePermitExpiresAt: device.permits[0]?.expiresAt.toISOString() ?? null,
    })),
  };
}

function policyData(command: Extract<OfflineManagementCommand, { operation: "UPDATE_POLICY" }>) {
  return {
    offlineEnabled: command.offlineEnabled,
    offlineWriteMode: command.offlineWriteMode,
    offlineLeaderDeviceId: command.offlineLeaderDeviceId,
    maxOfflineDurationMinutes: command.limits.maxOfflineDurationMinutes,
    maxPendingOrders: command.limits.maxPendingOrders,
    maxTotalAmount: command.limits.maxTotalAmount,
    maxSingleOrderAmount: command.limits.maxSingleOrderAmount,
  };
}

async function revokeActivePermits(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  stallId: string,
  now: Date,
) {
  await transaction.offlinePermit.updateMany({
    where: {
      organizationId,
      stallId,
      status: "ACTIVE",
    },
    data: {
      status: "REVOKED",
      revokedAt: now,
    },
  });
  await transaction.clientDevice.updateMany({
    where: { organizationId, stallId },
    data: { permitExpiresAt: null },
  });
}

export async function applyOfflineManagementCommand(input: {
  organizationId: string;
  stallId: string;
  command: OfflineManagementCommand;
  actor: OfflineActor;
}) {
  const shouldRequireFeature = input.command.operation === "UPDATE_POLICY"
    ? input.command.offlineEnabled
    : input.command.action === "APPROVE_READ_ONLY";
  if (shouldRequireFeature) {
    const flags = await resolveOfflineFlags(input.organizationId, input.stallId);
    assertOfflinePosEnabled(flags);
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`offline-policy:${input.stallId}`}, 0)
      )::text
    `;
    const now = new Date();

    if (input.command.operation === "UPDATE_POLICY") {
      const current = await transaction.offlineStallRuntimePolicy.findFirst({
        where: { organizationId: input.organizationId, stallId: input.stallId },
      });

      if (!input.command.offlineEnabled) {
        const updated = await transaction.offlineStallRuntimePolicy.upsert({
          where: { stallId: input.stallId },
          create: {
            organizationId: input.organizationId,
            stallId: input.stallId,
            ...policyData(input.command),
          },
          update: policyData(input.command),
        });
        await revokeActivePermits(transaction, input.organizationId, input.stallId, now);
        await transaction.clientDevice.updateMany({
          where: {
            organizationId: input.organizationId,
            stallId: input.stallId,
            offlineRole: "OFFLINE_LEADER",
          },
          data: { offlineRole: "OFFLINE_READ_ONLY" },
        });
        await transaction.auditLog.create({
          data: {
            organizationId: input.organizationId,
            stallId: input.stallId,
            actorProfileId: input.actor.profileId,
            action: "OFFLINE_POLICY_UPDATED",
            entityType: "OFFLINE_STALL_RUNTIME_POLICY",
            entityId: input.stallId,
            outcome: "SUCCESS",
            requestId: input.actor.requestId,
            ipHash: input.actor.ipHash,
            metadata: jsonMetadata({
              reason: input.command.reason.slice(0, 200),
              offlineEnabled: false,
            }),
            beforeJson: current ? policyAuditSnapshot(current) : undefined,
            afterJson: policyAuditSnapshot(updated),
          },
        });
        return;
      }

      const leader = await transaction.clientDevice.findFirst({
        where: {
          id: input.command.offlineLeaderDeviceId ?? "",
          organizationId: input.organizationId,
          stallId: input.stallId,
        },
      });
      if (!leader) throw new OfflineOperationError("OFFLINE_DEVICE_NOT_FOUND");
      if (["REVOKED", "LOST", "REPLACED"].includes(leader.status)) {
        throw new OfflineOperationError("OFFLINE_DEVICE_REQUIRES_MANAGER_REVIEW");
      }

      await transaction.offlineStallRuntimePolicy.upsert({
        where: { stallId: input.stallId },
        create: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          offlineEnabled: false,
          offlineWriteMode: "DISABLED",
          offlineLeaderDeviceId: null,
          ...input.command.limits,
        },
        update: {
          offlineEnabled: false,
          offlineWriteMode: "DISABLED",
          offlineLeaderDeviceId: null,
        },
      });
      await revokeActivePermits(transaction, input.organizationId, input.stallId, now);
      await transaction.clientDevice.updateMany({
        where: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          offlineRole: "OFFLINE_LEADER",
        },
        data: { offlineRole: "OFFLINE_READ_ONLY" },
      });
      await transaction.clientDevice.update({
        where: { id: leader.id },
        data: {
          status: "ACTIVE",
          offlineEnabled: true,
          offlineRole: "OFFLINE_LEADER",
          revokedAt: null,
        },
      });
      const updated = await transaction.offlineStallRuntimePolicy.update({
        where: { stallId: input.stallId },
        data: policyData(input.command),
      });
      await transaction.auditLog.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          actorProfileId: input.actor.profileId,
          action: "OFFLINE_LEADER_ASSIGNED",
          entityType: "OFFLINE_STALL_RUNTIME_POLICY",
          entityId: input.stallId,
          outcome: "SUCCESS",
          requestId: input.actor.requestId,
          ipHash: input.actor.ipHash,
          metadata: jsonMetadata({
            reason: input.command.reason.slice(0, 200),
            leaderDeviceId: leader.id,
          }),
          beforeJson: current ? policyAuditSnapshot(current) : undefined,
          afterJson: policyAuditSnapshot(updated),
        },
      });
      return;
    }

    const device = await transaction.clientDevice.findFirst({
      where: {
        id: input.command.deviceId,
        organizationId: input.organizationId,
        stallId: input.stallId,
      },
    });
    if (!device) throw new OfflineOperationError("OFFLINE_DEVICE_NOT_FOUND");
    if (
      input.command.action === "APPROVE_READ_ONLY"
      && ["REVOKED", "LOST", "REPLACED"].includes(device.status)
    ) {
      throw new OfflineOperationError("OFFLINE_DEVICE_REQUIRES_MANAGER_REVIEW");
    }

    if (device.offlineRole === "OFFLINE_LEADER") {
      await transaction.offlineStallRuntimePolicy.updateMany({
        where: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          offlineLeaderDeviceId: device.id,
        },
        data: {
          offlineEnabled: false,
          offlineWriteMode: "DISABLED",
          offlineLeaderDeviceId: null,
        },
      });
    }
    await revokeActivePermits(transaction, input.organizationId, input.stallId, now);

    const statusByAction = {
      APPROVE_READ_ONLY: "ACTIVE",
      DISABLE: "DISABLED",
      REVOKE: "REVOKED",
      MARK_LOST: "LOST",
    } as const;
    const approved = input.command.action === "APPROVE_READ_ONLY";
    const updated = await transaction.clientDevice.update({
      where: { id: device.id },
      data: {
        status: statusByAction[input.command.action],
        offlineEnabled: approved,
        offlineRole: approved ? "OFFLINE_READ_ONLY" : "NONE",
        revokedAt: ["REVOKE", "MARK_LOST"].includes(input.command.action) ? now : null,
        permitExpiresAt: null,
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        actorProfileId: input.actor.profileId,
        action: `OFFLINE_DEVICE_${input.command.action}`,
        entityType: "CLIENT_DEVICE",
        entityId: device.id,
        outcome: "SUCCESS",
        requestId: input.actor.requestId,
        ipHash: input.actor.ipHash,
        metadata: jsonMetadata({ reason: input.command.reason.slice(0, 200) }),
        beforeJson: deviceAuditSnapshot(device),
        afterJson: deviceAuditSnapshot(updated),
      },
    });
  }, { isolationLevel: "Serializable" });

  return getOfflineManagementState(input.organizationId, input.stallId);
}

export async function issueOfflineBootstrap(input: IssueBootstrapInput) {
  if (["INSUFFICIENT", "UNAVAILABLE"].includes(input.command.storageClass)) {
    throw new OfflineOperationError("OFFLINE_STORAGE_READ_ONLY");
  }

  const device = await prisma.clientDevice.findUnique({
    where: {
      organizationId_installationId: {
        organizationId: input.organizationId,
        installationId: input.command.installationId,
      },
    },
  });
  if (
    !device
    || device.stallId !== input.stallId
    || device.profileId !== input.profileId
  ) {
    throw new OfflineOperationError("OFFLINE_DEVICE_NOT_FOUND");
  }
  const flags = await resolveOfflineFlags(input.organizationId, input.stallId, device.id);
  assertOfflinePosEnabled(flags);
  if (
    device.status !== "ACTIVE"
    || !device.offlineEnabled
    || device.offlineRole !== "OFFLINE_LEADER"
  ) {
    throw new OfflineOperationError("OFFLINE_DEVICE_NOT_LEADER");
  }

  const [policy, runtime] = await Promise.all([
    prisma.offlineStallRuntimePolicy.findFirst({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        offlineEnabled: true,
        offlineWriteMode: "SINGLE_DEVICE_ONLY",
        offlineLeaderDeviceId: device.id,
      },
    }),
    prisma.backendRuntimeState.findFirst({
      where: {
        isCurrent: true,
        backendRole: "ACTIVE_WRITER",
        writesEnabled: true,
      },
    }),
  ]);
  if (!policy) throw new OfflineOperationError("OFFLINE_POLICY_NOT_ACTIVE");
  if (!runtime) throw new OfflineOperationError("BACKEND_NOT_WRITABLE");

  const storageClass = input.command.storageClass as "PERSISTENT" | "BEST_EFFORT";
  const riskLimits = boundedOfflineRiskLimits({
    maxOfflineDurationMinutes: policy.maxOfflineDurationMinutes,
    maxPendingOrders: policy.maxPendingOrders,
    maxTotalAmount: Number(policy.maxTotalAmount),
    maxSingleOrderAmount: Number(policy.maxSingleOrderAmount),
  }, storageClass, input.command.requestedDurationMinutes);
  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() + riskLimits.maxOfflineDurationMinutes * 60_000,
  );
  const { snapshot, catalog, publicSnapshot } = await createOrReuseOfflineMenuSnapshot({
    organizationId: input.organizationId,
    stallId: input.stallId,
    minimumExpiresAt: expiresAt,
    includeManualPayment: flags.OFFLINE_MANUAL_PAYMENT_ENABLED.enabled,
  });

  const roles = [...new Set(input.roles.filter((role) => PERMIT_ROLES.has(role)))] as OfflinePermitPayload["roles"];
  if (roles.length === 0) throw new OfflineOperationError("OFFLINE_ROLE_NOT_ALLOWED");
  const allowedOfflineActions: OfflinePermitPayload["allowedOfflineActions"] = [
    "CREATE_OFFLINE_ORDER",
  ];
  if (
    flags.OFFLINE_MANUAL_PAYMENT_ENABLED.enabled
    && catalog.paymentOptions.length > 0
  ) {
    allowedOfflineActions.push("RECORD_CASH_PAYMENT");
  }
  if (catalog.modules.print) allowedOfflineActions.push("QUEUE_PRINT_JOB");

  const permitId = randomUUID();
  const payload: OfflinePermitPayload = {
    permitId,
    deviceId: device.id,
    profileId: input.profileId,
    organizationId: input.organizationId,
    stallId: input.stallId,
    roles,
    allowedOfflineActions,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    menuSnapshotVersion: snapshot.version,
    promotionEpoch: runtime.promotionEpoch.toString(),
    appProtocolVersion: input.command.appProtocolVersion,
    storageClass,
    riskLimits,
  };
  const permitToken = signOfflinePermit(payload, requireOfflinePermitSigningSecret());

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`offline-permit:${device.id}`}, 0)
      )::text
    `;
    const now = new Date();
    await transaction.offlinePermit.updateMany({
      where: {
        deviceId: device.id,
        status: "ACTIVE",
        expiresAt: { lte: now },
      },
      data: { status: "EXPIRED" },
    });
    await transaction.offlinePermit.updateMany({
      where: {
        deviceId: device.id,
        status: "ACTIVE",
      },
      data: { status: "REVOKED", revokedAt: now },
    });
    await transaction.offlinePermit.create({
      data: {
        id: permitId,
        organizationId: input.organizationId,
        stallId: input.stallId,
        deviceId: device.id,
        profileId: input.profileId,
        menuSnapshotId: snapshot.id,
        menuSnapshotVersion: snapshot.version,
        tokenHash: hashToken(permitToken),
        rolesJson: roles,
        allowedActionsJson: allowedOfflineActions,
        promotionEpoch: runtime.promotionEpoch,
        issuedAt,
        expiresAt,
      },
    });
    await transaction.clientDevice.update({
      where: { id: device.id },
      data: {
        permitExpiresAt: expiresAt,
        lastOnlineAt: now,
        appVersion: device.appVersion,
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        actorProfileId: input.profileId,
        action: "OFFLINE_PERMIT_ISSUED",
        entityType: "OFFLINE_PERMIT",
        entityId: permitId,
        outcome: "SUCCESS",
        requestId: input.actor.requestId,
        ipHash: input.actor.ipHash,
        metadata: jsonMetadata({
          deviceId: device.id,
          storageClass,
          expiresAt: expiresAt.toISOString(),
          menuSnapshotVersion: snapshot.version,
          promotionEpoch: runtime.promotionEpoch.toString(),
        }),
      },
    });
  }, { isolationLevel: "Serializable" });

  return {
    permitToken,
    permit: payload,
    device: safeDevice({ ...device, permitExpiresAt: expiresAt }),
    menuSnapshot: {
      id: snapshot.id,
      version: snapshot.version,
      contentHash: snapshot.contentHash,
      currency: snapshot.currency,
      generatedAt: snapshot.generatedAt.toISOString(),
      expiresAt: snapshot.expiresAt.toISOString(),
      catalog,
      publicSnapshot,
    },
  };
}
