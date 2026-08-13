"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  CloudOff,
  RefreshCw,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { usePwaRuntime } from "@/components/pwa-runtime";
import type { OperationsMessageKey } from "@/lib/messages/operations";
import { getOfflineQueueSummary } from "@/offline/offline-operations";
import {
  startOfflineSyncCoordinator,
  synchronizeOfflineQueue,
  type OfflineSyncResult,
  type OfflineSyncStage,
} from "@/offline/sync-engine";

type QueueSummary = Awaited<ReturnType<typeof getOfflineQueueSummary>>;
type OfflineRuntimeState =
  | "ONLINE"
  | "DEGRADED"
  | "OFFLINE"
  | "SYNCHRONIZING"
  | "CONFLICT"
  | "PERMIT_EXPIRED"
  | "DEVICE_REVOKED"
  | "STORAGE_AT_RISK";

const syncStageKeys: Record<OfflineSyncStage, OperationsMessageKey> = {
  READ_CONTEXT: "offline.queue.sync.readContext",
  CHECK_AVAILABILITY: "offline.queue.sync.checkAvailability",
  ACQUIRE_LOCK: "offline.queue.sync.acquireLock",
  LOAD_BATCH: "offline.queue.sync.loadBatch",
  MARK_PROCESSING: "offline.queue.sync.markProcessing",
  UPLOAD: "offline.queue.sync.upload",
  APPLY_RECEIPTS: "offline.queue.sync.applyReceipts",
  COMPLETE: "offline.queue.sync.complete",
};

const stateCopy: Record<OfflineRuntimeState, {
  label: OperationsMessageKey;
  works: OperationsMessageKey;
  unavailable: OperationsMessageKey;
  className: string;
}> = {
  ONLINE: {
    label: "offline.queue.state.online.label",
    works: "offline.queue.state.online.works",
    unavailable: "offline.queue.state.online.unavailable",
    className: "border-emerald-300 bg-emerald-50 text-emerald-950",
  },
  DEGRADED: {
    label: "offline.queue.state.degraded.label",
    works: "offline.queue.state.degraded.works",
    unavailable: "offline.queue.state.degraded.unavailable",
    className: "border-amber-300 bg-amber-50 text-amber-950",
  },
  OFFLINE: {
    label: "offline.queue.state.offline.label",
    works: "offline.queue.state.offline.works",
    unavailable: "offline.queue.state.offline.unavailable",
    className: "border-red-300 bg-red-50 text-red-950",
  },
  SYNCHRONIZING: {
    label: "offline.queue.state.synchronizing.label",
    works: "offline.queue.state.synchronizing.works",
    unavailable: "offline.queue.state.synchronizing.unavailable",
    className: "border-sky-300 bg-sky-50 text-sky-950",
  },
  CONFLICT: {
    label: "offline.queue.state.conflict.label",
    works: "offline.queue.state.conflict.works",
    unavailable: "offline.queue.state.conflict.unavailable",
    className: "border-orange-400 bg-orange-50 text-orange-950",
  },
  PERMIT_EXPIRED: {
    label: "offline.queue.state.permitExpired.label",
    works: "offline.queue.state.permitExpired.works",
    unavailable: "offline.queue.state.permitExpired.unavailable",
    className: "border-red-400 bg-red-50 text-red-950",
  },
  DEVICE_REVOKED: {
    label: "offline.queue.state.deviceRevoked.label",
    works: "offline.queue.state.deviceRevoked.works",
    unavailable: "offline.queue.state.deviceRevoked.unavailable",
    className: "border-red-500 bg-red-50 text-red-950",
  },
  STORAGE_AT_RISK: {
    label: "offline.queue.state.storageRisk.label",
    works: "offline.queue.state.storageRisk.works",
    unavailable: "offline.queue.state.storageRisk.unavailable",
    className: "border-amber-400 bg-amber-50 text-amber-950",
  },
};

function relativeMinutes(timestamp: string | null, now: number) {
  if (!timestamp) return null;
  return Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000));
}

export function OfflineQueueStatus({
  stallId,
  stallSlug,
  onSynchronized,
}: {
  stallId: string;
  stallSlug: string;
  onSynchronized?: () => void;
}) {
  const { t } = useOperationsLocale();
  const { online, quality } = usePwaRuntime();
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStage, setSyncStage] = useState<OfflineSyncStage | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState<number | null>(null);
  const onSynchronizedRef = useRef(onSynchronized);

  useEffect(() => {
    onSynchronizedRef.current = onSynchronized;
  }, [onSynchronized]);

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await getOfflineQueueSummary(stallId));
    } catch {
      setSummary(null);
    }
  }, [stallId]);

  const consumeResult = useCallback((result: OfflineSyncResult) => {
    setSyncing(false);
    setSyncStage(null);
    setLastErrorCode(result.status === "FAILED" ? result.errorCode : null);
    void refreshSummary();
    if (result.status === "SYNCED" && result.synchronized > 0) {
      onSynchronizedRef.current?.();
    }
  }, [refreshSummary]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshSummary(), 0);
    const onDataChanged = () => void refreshSummary();
    window.addEventListener("stallorder:offline-data-changed", onDataChanged);
    const stop = startOfflineSyncCoordinator({
      stallId,
      stallSlug,
      onStage: (stage) => setSyncStage(stage),
      onResult: consumeResult,
    });
    return () => {
      window.clearTimeout(initialRefresh);
      stop();
      window.removeEventListener("stallorder:offline-data-changed", onDataChanged);
    };
  }, [consumeResult, online, refreshSummary, stallId, stallSlug]);

  useEffect(() => {
    const updateClock = () => setClockMs(Date.now());
    const initialTick = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 60_000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(timer);
    };
  }, []);

  const state = useMemo<OfflineRuntimeState>(() => {
    if (lastErrorCode === "OFFLINE_SYNC_DEVICE_INVALID") return "DEVICE_REVOKED";
    if (syncing) return "SYNCHRONIZING";
    if (summary?.conflictCount) return "CONFLICT";
    if (
      clockMs !== null
      && summary?.permitExpiresAt
      && Date.parse(summary.permitExpiresAt) <= clockMs
    ) {
      return "PERMIT_EXPIRED";
    }
    if (summary?.storageClass === "BEST_EFFORT" || summary?.storageClass === "INSUFFICIENT") {
      return "STORAGE_AT_RISK";
    }
    if (!online) return "OFFLINE";
    if (quality === "POOR") return "DEGRADED";
    return "ONLINE";
  }, [clockMs, lastErrorCode, online, quality, summary, syncing]);
  const copy = stateCopy[state];
  const pendingCount = summary?.pendingCount ?? 0;
  const oldestMinutes = clockMs !== null
    ? relativeMinutes(summary?.oldestPendingAt ?? null, clockMs)
    : null;
  const permitMinutes = summary?.permitExpiresAt && clockMs !== null
    ? Math.max(0, Math.floor((Date.parse(summary.permitExpiresAt) - clockMs) / 60_000))
    : null;

  if (!summary?.permitExpiresAt && pendingCount === 0) return null;

  async function retry() {
    setSyncing(true);
    setLastErrorCode(null);
    consumeResult(await synchronizeOfflineQueue({
      stallId,
      stallSlug,
      onStage: (stage) => setSyncStage(stage),
    }));
  }

  return (
    <section
      aria-label={t("offline.queue.aria")}
      className={`mt-4 border-y px-3 py-3 print:hidden ${copy.className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            {state === "ONLINE"
              ? <Wifi className="h-4 w-4" />
              : state === "CONFLICT" || state === "DEVICE_REVOKED"
                ? <ShieldAlert className="h-4 w-4" />
                : state === "OFFLINE"
                  ? <CloudOff className="h-4 w-4" />
                  : <CircleAlert className="h-4 w-4" />}
            <span>{t(copy.label)}</span>
            <span className="text-xs font-medium">{t("offline.queue.pending", { count: pendingCount })}</span>
          </div>
          <p className="mt-1 text-xs">{t(copy.works)}</p>
          <p className="mt-0.5 text-xs opacity-80">{t(copy.unavailable)}</p>
          <p className="mt-1 text-xs opacity-80">
            {oldestMinutes !== null ? t("offline.queue.oldest", { minutes: oldestMinutes }) : t("offline.queue.empty")}
            {permitMinutes !== null ? ` · ${t("offline.queue.permitRemaining", { minutes: permitMinutes })}` : ""}
          </p>
          {syncStage ? (
            <p className="mt-1 text-xs font-semibold">{t("offline.queue.stage", { stage: t(syncStageKeys[syncStage]) })}</p>
          ) : null}
          {lastErrorCode ? (
            <p className="mt-1 text-xs font-semibold">{t("offline.queue.errorCode", { code: lastErrorCode })}</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!online || syncing || pendingCount === 0}
          onClick={() => void retry()}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-current bg-white px-3 text-sm font-semibold disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {t("offline.queue.retry")}
        </button>
      </div>
    </section>
  );
}
