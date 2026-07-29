"use client";

import { OFFLINE_APP_PROTOCOL_VERSION } from "@/offline/offline-contract";
import {
  offlineSyncResponseSchema,
  type OfflineSyncResponse,
} from "@/offline/offline-order-contract";
import {
  applyOfflineSyncResponse,
  getOfflineSyncContext,
  loadOfflineSyncBatch,
  markOfflineSyncAttempt,
  purgeExpiredOfflinePayloads,
} from "@/offline/offline-operations";
import { withOfflineSyncLock } from "@/offline/offline-sync-lock";
import { csrfHeaders } from "@/lib/csrf-client";

const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;
const PROCESSING_LEASE_MS = 60_000;
export const OFFLINE_BACKGROUND_SYNC_TAG = "stallorder-offline-sync";
export const offlineSyncStages = [
  "READ_CONTEXT",
  "CHECK_AVAILABILITY",
  "ACQUIRE_LOCK",
  "LOAD_BATCH",
  "MARK_PROCESSING",
  "UPLOAD",
  "APPLY_RECEIPTS",
  "COMPLETE",
] as const;
export type OfflineSyncStage = (typeof offlineSyncStages)[number];

type AvailabilityResponse = {
  staffOnline?: string;
  activeBackend?: string;
  promotionEpoch?: number;
};

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
};

export type OfflineSyncResult =
  | { status: "SYNCED"; synchronized: number; conflicts: number }
  | { status: "EMPTY"; synchronized: 0; conflicts: 0 }
  | { status: "LOCKED"; synchronized: 0; conflicts: 0 }
  | { status: "UNAVAILABLE"; synchronized: 0; conflicts: 0 }
  | { status: "NOT_CONFIGURED"; synchronized: 0; conflicts: 0 }
  | { status: "FAILED"; synchronized: 0; conflicts: 0; retryAt: string; errorCode: string };

export function calculateOfflineRetryDelay(
  attempt: number,
  randomValue = Math.random(),
) {
  const exponent = Math.max(0, Math.min(12, Math.trunc(attempt) - 1));
  const base = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** exponent);
  const boundedRandom = Math.max(0, Math.min(1, randomValue));
  return Math.min(
    MAX_RETRY_MS,
    Math.round(base * (0.75 + boundedRandom * 0.5)),
  );
}

async function availabilityAllowsSync(
  deviceId: string,
  fetchImpl: typeof fetch,
) {
  try {
    const response = await fetchImpl("/api/availability/config", {
      method: "GET",
      cache: "no-store",
      headers: { "x-stallorder-device-id": deviceId },
    });
    if (!response.ok) return false;
    const availability = await response.json() as AvailabilityResponse;
    return availability.staffOnline === "AVAILABLE"
      || availability.staffOnline === "DEGRADED";
  } catch {
    return false;
  }
}

export async function registerOfflineBackgroundSync() {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready as SyncRegistration;
    if (!registration.sync) return false;
    await registration.sync.register(OFFLINE_BACKGROUND_SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

export async function synchronizeOfflineQueue(input: {
  stallId: string;
  stallSlug: string;
  batchSize?: number;
  fetchImpl?: typeof fetch;
  onStage?: (stage: OfflineSyncStage) => void;
}): Promise<OfflineSyncResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  input.onStage?.("READ_CONTEXT");
  const context = await getOfflineSyncContext(input.stallId);
  if (!context) {
    return { status: "NOT_CONFIGURED", synchronized: 0, conflicts: 0 };
  }
  input.onStage?.("CHECK_AVAILABILITY");
  if (!navigator.onLine || !await availabilityAllowsSync(context.deviceId, fetchImpl)) {
    await registerOfflineBackgroundSync();
    return { status: "UNAVAILABLE", synchronized: 0, conflicts: 0 };
  }

  input.onStage?.("ACQUIRE_LOCK");
  const locked = await withOfflineSyncLock(context.installationId, async () => {
    input.onStage?.("LOAD_BATCH");
    const records = await loadOfflineSyncBatch(input.stallId, input.batchSize ?? 25);
    if (records.length === 0) {
      await purgeExpiredOfflinePayloads();
      input.onStage?.("COMPLETE");
      return { status: "EMPTY", synchronized: 0, conflicts: 0 } as const;
    }
    const queueIds = records.map((record) => record.queueId);
    const attempt = Math.max(
      1,
      ...records.map((record) => (
        record.recordType === "ORDER" ? record.order.retryCount + 1 : 1
      )),
    );
    input.onStage?.("MARK_PROCESSING");
    await markOfflineSyncAttempt(
      queueIds,
      "PROCESSING",
      new Date(Date.now() + PROCESSING_LEASE_MS),
    );
    try {
      input.onStage?.("UPLOAD");
      const response = await fetchImpl("/api/offline/sync", {
        method: "POST",
        headers: {
          ...csrfHeaders(),
          "x-stall-slug": input.stallSlug,
        },
        body: JSON.stringify({
          installationId: context.installationId,
          permitToken: context.permitToken,
          appProtocolVersion: OFFLINE_APP_PROTOCOL_VERSION,
          clientSentAt: new Date().toISOString(),
          records,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const code = typeof payload?.code === "string"
          ? payload.code
          : `HTTP_${response.status}`;
        throw new Error(code);
      }
      const parsed = offlineSyncResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("OFFLINE_SYNC_RESPONSE_INVALID");
      input.onStage?.("APPLY_RECEIPTS");
      await applyOfflineSyncResponse(parsed.data as OfflineSyncResponse);
      await purgeExpiredOfflinePayloads();
      input.onStage?.("COMPLETE");
      return {
        status: "SYNCED",
        synchronized: parsed.data.receipts.filter(
          (receipt) => receipt.outcome !== "REJECTED",
        ).length,
        conflicts: parsed.data.receipts.reduce(
          (count, receipt) => count + receipt.conflicts.length,
          0,
        ),
      } as const;
    } catch (error) {
      const retryAt = new Date(Date.now() + calculateOfflineRetryDelay(attempt));
      await markOfflineSyncAttempt(queueIds, "FAILED", retryAt);
      await registerOfflineBackgroundSync();
      return {
        status: "FAILED",
        synchronized: 0,
        conflicts: 0,
        retryAt: retryAt.toISOString(),
        errorCode: error instanceof Error
          ? error.message.slice(0, 120)
          : "OFFLINE_SYNC_FAILED",
      } as const;
    }
  });
  return locked.acquired
    ? locked.value
    : { status: "LOCKED", synchronized: 0, conflicts: 0 };
}

export function startOfflineSyncCoordinator(input: {
  stallId: string;
  stallSlug: string;
  onStage?: (stage: OfflineSyncStage) => void;
  onResult?: (result: OfflineSyncResult) => void;
}) {
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running || !navigator.onLine) return;
    running = true;
    try {
      const result = await synchronizeOfflineQueue(input);
      if (!stopped) input.onResult?.(result);
    } finally {
      running = false;
    }
  };
  const onOnline = () => void run();
  const onVisibility = () => {
    if (document.visibilityState === "visible") void run();
  };
  const onServiceWorkerMessage = (event: MessageEvent) => {
    if (event.data?.type === "OFFLINE_SYNC_REQUESTED") void run();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
  navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);
  const initial = window.setTimeout(() => void run(), 0);
  const timer = window.setInterval(() => void run(), 30_000);
  return () => {
    stopped = true;
    window.clearTimeout(initial);
    window.clearInterval(timer);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
  };
}
