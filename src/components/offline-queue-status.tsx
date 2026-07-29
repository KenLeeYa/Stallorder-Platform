"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  CloudOff,
  RefreshCw,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { usePwaRuntime } from "@/components/pwa-runtime";
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

const syncStageCopy: Record<OfflineSyncStage, string> = {
  READ_CONTEXT: "讀取本機授權",
  CHECK_AVAILABILITY: "確認後端可用性",
  ACQUIRE_LOCK: "取得同步鎖",
  LOAD_BATCH: "整理待同步資料",
  MARK_PROCESSING: "鎖定同步批次",
  UPLOAD: "送出同步資料",
  APPLY_RECEIPTS: "套用伺服器回條",
  COMPLETE: "完成同步",
};

const stateCopy: Record<OfflineRuntimeState, {
  label: string;
  works: string;
  unavailable: string;
  className: string;
}> = {
  ONLINE: {
    label: "線上",
    works: "線上訂單與離線佇列同步皆可使用。",
    unavailable: "無",
    className: "border-emerald-300 bg-emerald-50 text-emerald-950",
  },
  DEGRADED: {
    label: "網路不穩",
    works: "已核准裝置仍可建立離線外帶訂單。",
    unavailable: "同步可能延遲，請保留此頁面。",
    className: "border-amber-300 bg-amber-50 text-amber-950",
  },
  OFFLINE: {
    label: "離線營運",
    works: "可使用快照菜單、現金或核准的人工付款。",
    unavailable: "線上付款、退款與新開班暫停。",
    className: "border-red-300 bg-red-50 text-red-950",
  },
  SYNCHRONIZING: {
    label: "同步中",
    works: "本機訂單安全保留，正在逐筆取得伺服器回條。",
    unavailable: "同步完成前請勿登出、切換攤位或清除資料。",
    className: "border-sky-300 bg-sky-50 text-sky-950",
  },
  CONFLICT: {
    label: "需要核對",
    works: "已接受的訂單仍保留正式編號與本機編號。",
    unavailable: "衝突需由管理者核對，不會自動刪除。",
    className: "border-orange-400 bg-orange-50 text-orange-950",
  },
  PERMIT_EXPIRED: {
    label: "離線授權已到期",
    works: "既有未同步資料仍會保留並可重送。",
    unavailable: "不可再建立新的離線訂單，請連線後重新啟用。",
    className: "border-red-400 bg-red-50 text-red-950",
  },
  DEVICE_REVOKED: {
    label: "裝置已撤銷",
    works: "既有資料仍保留供管理者處理。",
    unavailable: "不可建立或同步新資料，請聯絡攤位管理者。",
    className: "border-red-500 bg-red-50 text-red-950",
  },
  STORAGE_AT_RISK: {
    label: "儲存空間有風險",
    works: "既有本機資料仍保留並優先同步。",
    unavailable: "不建議持續離線收單，請先恢復網路。",
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
      aria-label="離線營運狀態"
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
            <span>{copy.label}</span>
            <span className="text-xs font-medium">待同步 {pendingCount} 筆</span>
          </div>
          <p className="mt-1 text-xs">{copy.works}</p>
          <p className="mt-0.5 text-xs opacity-80">{copy.unavailable}</p>
          <p className="mt-1 text-xs opacity-80">
            {oldestMinutes !== null ? `最舊待同步 ${oldestMinutes} 分鐘` : "目前沒有待同步資料"}
            {permitMinutes !== null ? ` · 授權剩餘 ${permitMinutes} 分鐘` : ""}
          </p>
          {syncStage ? (
            <p className="mt-1 text-xs font-semibold">同步階段：{syncStageCopy[syncStage]}</p>
          ) : null}
          {lastErrorCode ? (
            <p className="mt-1 text-xs font-semibold">同步暫未完成 · 錯誤代碼 {lastErrorCode}</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!online || syncing || pendingCount === 0}
          onClick={() => void retry()}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-current bg-white px-3 text-sm font-semibold disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          立即同步
        </button>
      </div>
    </section>
  );
}
