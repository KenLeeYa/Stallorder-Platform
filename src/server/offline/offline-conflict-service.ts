import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ResolveOfflineConflictCommand } from "@/offline/offline-contract";

const OPEN_RESOLUTION_STATUS = "OPEN";
const SAFE_DETAIL_KEYS = new Set([
  "errorCode",
  "menuSnapshotVersion",
  "promotionEpoch",
  "activePromotionEpoch",
]);

export class OfflineConflictOperationError extends Error {
  constructor(public readonly code:
    | "OFFLINE_CONFLICT_NOT_FOUND"
    | "OFFLINE_CONFLICT_ALREADY_RESOLVED") {
    super(code);
    this.name = "OfflineConflictOperationError";
  }
}

function safeDetails(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, detail] of Object.entries(value)) {
    if (
      SAFE_DETAIL_KEYS.has(key)
      && (typeof detail === "string"
        || typeof detail === "number"
        || typeof detail === "boolean")
    ) {
      result[key] = detail;
    }
  }
  return result;
}

export async function listOfflineSyncConflicts(
  organizationId: string,
  stallId: string,
) {
  const conflicts = await prisma.offlineSyncConflict.findMany({
    where: { organizationId, stallId },
    orderBy: [{ resolutionStatus: "asc" }, { detectedAt: "desc" }],
    take: 100,
  });
  const [devices, orders, profiles] = await Promise.all([
    prisma.clientDevice.findMany({
      where: {
        organizationId,
        stallId,
        id: { in: [...new Set(conflicts.map((conflict) => conflict.deviceId))] },
      },
      select: { id: true, displayName: true },
    }),
    prisma.order.findMany({
      where: {
        organizationId,
        stallId,
        id: {
          in: conflicts.flatMap((conflict) => conflict.orderId ? [conflict.orderId] : []),
        },
      },
      select: { id: true, orderNo: true },
    }),
    prisma.profile.findMany({
      where: {
        id: {
          in: conflicts.flatMap(
            (conflict) => conflict.resolvedByProfileId ? [conflict.resolvedByProfileId] : [],
          ),
        },
      },
      select: { id: true, displayName: true },
    }),
  ]);
  const deviceNames = new Map(devices.map((device) => [device.id, device.displayName]));
  const orderNumbers = new Map(orders.map((order) => [order.id, order.orderNo]));
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.displayName]));

  return conflicts.map((conflict) => ({
    id: conflict.id,
    deviceId: conflict.deviceId,
    deviceName: deviceNames.get(conflict.deviceId) ?? "已撤銷裝置",
    localEntityType: conflict.localEntityType,
    localEntityId: conflict.localEntityId,
    offlineOrderId: conflict.offlineOrderId,
    canonicalOrderNumber: conflict.orderId
      ? orderNumbers.get(conflict.orderId) ?? null
      : null,
    conflictType: conflict.conflictType,
    resolutionStatus: conflict.resolutionStatus,
    details: safeDetails(conflict.detailsJson),
    detectedAt: conflict.detectedAt.toISOString(),
    resolvedAt: conflict.resolvedAt?.toISOString() ?? null,
    resolvedBy: conflict.resolvedByProfileId
      ? profileNames.get(conflict.resolvedByProfileId) ?? "管理者"
      : null,
  }));
}

export async function resolveOfflineSyncConflict(input: {
  organizationId: string;
  stallId: string;
  command: ResolveOfflineConflictCommand;
  actor: {
    profileId: string;
    requestId: string;
    ipHash: string;
  };
}) {
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`offline-conflict:${input.command.conflictId}`}, 0)
      )::text
    `;
    const conflict = await transaction.offlineSyncConflict.findFirst({
      where: {
        id: input.command.conflictId,
        organizationId: input.organizationId,
        stallId: input.stallId,
      },
    });
    if (!conflict) {
      throw new OfflineConflictOperationError("OFFLINE_CONFLICT_NOT_FOUND");
    }
    if (conflict.resolutionStatus !== OPEN_RESOLUTION_STATUS) {
      throw new OfflineConflictOperationError("OFFLINE_CONFLICT_ALREADY_RESOLVED");
    }

    const resolvedAt = new Date();
    await transaction.offlineSyncConflict.update({
      where: { id: conflict.id },
      data: {
        resolutionStatus: input.command.resolutionStatus,
        resolvedAt,
        resolvedByProfileId: input.actor.profileId,
      },
    });
    if (conflict.orderId) {
      const remaining = await transaction.offlineSyncConflict.count({
        where: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          orderId: conflict.orderId,
          resolutionStatus: OPEN_RESOLUTION_STATUS,
          id: { not: conflict.id },
        },
      });
      if (remaining === 0) {
        await transaction.order.updateMany({
          where: {
            id: conflict.orderId,
            organizationId: input.organizationId,
            stallId: input.stallId,
          },
          data: { offlineConflictStatus: "RESOLVED" },
        });
      }
    }
    await transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        actorProfileId: input.actor.profileId,
        action: "OFFLINE_SYNC_CONFLICT_RESOLVED",
        entityType: "OFFLINE_SYNC_CONFLICT",
        entityId: conflict.id,
        outcome: "SUCCESS",
        requestId: input.actor.requestId,
        ipHash: input.actor.ipHash,
        metadata: input.command.reason,
        beforeJson: {
          resolutionStatus: conflict.resolutionStatus,
          conflictType: conflict.conflictType,
        },
        afterJson: {
          resolutionStatus: input.command.resolutionStatus,
          reason: input.command.reason,
        },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return listOfflineSyncConflicts(input.organizationId, input.stallId);
}
