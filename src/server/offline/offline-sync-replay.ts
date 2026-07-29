import "server-only";

import type { OrderOrigin } from "@prisma/client";
import { hashToken, safeEqual } from "@/lib/security";

type ExistingOrderIdentity = {
  organizationId: string;
  stallId: string;
  source: string;
  origin: OrderOrigin;
  deviceHash: string;
  sourceDeviceId: string | null;
  offlineOrderId: string | null;
  idempotencyKey: string;
};

export function rejectedInboxReplayErrorCode(
  status: string,
  result: unknown,
) {
  if (status !== "REJECTED") return null;
  if (
    result
    && typeof result === "object"
    && !Array.isArray(result)
    && "errorCode" in result
    && typeof result.errorCode === "string"
    && /^[A-Z0-9_]{1,120}$/.test(result.errorCode)
  ) {
    return result.errorCode;
  }
  return "OFFLINE_SYNC_REJECTED";
}

export function matchesExistingOrderReplay(input: {
  existing: ExistingOrderIdentity;
  organizationId: string;
  stallId: string;
  deviceId: string;
  actorProfileId: string;
  offlineOrderId: string;
  idempotencyKey: string;
}) {
  if (input.existing.idempotencyKey !== input.idempotencyKey) return false;
  const matchingOfflineImport = (
    input.existing.sourceDeviceId === input.deviceId
    && input.existing.offlineOrderId === input.offlineOrderId
  );
  const matchingOnlineStaffReplay = (
    input.existing.organizationId === input.organizationId
    && input.existing.stallId === input.stallId
    && input.existing.source === "STAFF_POS"
    && input.existing.origin === "ONLINE_STAFF"
    && input.existing.sourceDeviceId === null
    && input.existing.offlineOrderId === null
    && safeEqual(
      input.existing.deviceHash,
      hashToken(`staff-order:${input.actorProfileId}:STAFF_POS`),
    )
  );
  return matchingOfflineImport || matchingOnlineStaffReplay;
}
