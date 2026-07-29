"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, RefreshCw, ShieldAlert } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatTaipeiDateTime } from "@/lib/date-time";

export type OfflineConflictView = {
  id: string;
  deviceId: string;
  deviceName: string;
  localEntityType: string;
  localEntityId: string;
  offlineOrderId: string | null;
  canonicalOrderNumber: string | null;
  conflictType: string;
  resolutionStatus: string;
  details: Record<string, string | number | boolean>;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

const conflictLabels: Record<string, string> = {
  MENU_VERSION_EXPIRED: "菜單版本已過期",
  PRICE_CHANGED: "價格已變更",
  PRODUCT_DISABLED: "商品已停用",
  PRODUCT_DELETED: "商品已刪除",
  ROLE_CHANGED: "操作角色已變更",
  DEVICE_REVOKED: "裝置已撤銷",
  INVALID_STATE_TRANSITION: "訂單狀態不一致",
  DUPLICATE_ORDER: "偵測到重複訂單",
  PAYMENT_RECONCILIATION_REQUIRED: "付款需要對帳",
  CLOCK_SKEW: "裝置時間偏差",
  BACKEND_EPOCH_CHANGED: "後端切換期間建立",
  CASH_TOTAL_MISMATCH: "現金金額不一致",
  PRINT_STATUS_UNKNOWN: "列印狀態待確認",
  UNKNOWN_REFERENCE: "參照資料不存在",
  SHIFT_ALREADY_CLOSED: "原現金班別已關閉",
  DUPLICATE_CASH_MOVEMENT: "重複現金異動",
  MULTIPLE_OFFLINE_SHIFT: "偵測到多個離線班別",
};

const resolutionLabels: Record<string, string> = {
  OPEN: "待處理",
  AUTO_RESOLVED: "系統已處理",
  ACCEPTED_LOCAL: "接受本機紀錄",
  MERGED: "已人工合併",
  REJECTED: "拒絕本機紀錄",
  CANCELLED: "取消衝突紀錄",
};

const resolutionOptions = [
  { value: "ACCEPTED_LOCAL", label: "已核對，接受本機紀錄" },
  { value: "MERGED", label: "已人工合併" },
  { value: "REJECTED", label: "拒絕本機紀錄" },
  { value: "CANCELLED", label: "取消此衝突紀錄" },
] as const;

export function OfflineConflictManager({
  stallId,
  initialConflicts,
}: {
  stallId: string;
  initialConflicts: OfflineConflictView[];
}) {
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [resolutionById, setResolutionById] = useState<Record<string, string>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const openCount = useMemo(
    () => conflicts.filter((conflict) => conflict.resolutionStatus === "OPEN").length,
    [conflicts],
  );

  async function refresh() {
    setBusyId("refresh");
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/offline/conflicts`, {
        cache: "no-store",
      });
      const payload = await response.json() as {
        conflicts?: OfflineConflictView[];
        error?: string;
      };
      if (!response.ok || !payload.conflicts) {
        throw new Error(payload.error ?? "目前無法重新載入同步衝突。");
      }
      setConflicts(payload.conflicts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法重新載入同步衝突。");
    } finally {
      setBusyId(null);
    }
  }

  async function resolveConflict(conflict: OfflineConflictView) {
    const resolutionStatus = resolutionById[conflict.id] ?? "";
    const reason = reasonById[conflict.id]?.trim() ?? "";
    if (!resolutionStatus) {
      setMessage("請先選擇處理結果。");
      return;
    }
    if (reason.length < 5) {
      setMessage("請輸入至少 5 個字元的處理原因。");
      return;
    }
    if (
      ["REJECTED", "CANCELLED"].includes(resolutionStatus)
      && !window.confirm("確定套用此處理結果？系統會保留稽核紀錄，送出後不可直接復原。")
    ) {
      return;
    }

    setBusyId(conflict.id);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/offline/conflicts`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          conflictId: conflict.id,
          resolutionStatus,
          reason,
        }),
      });
      const payload = await response.json() as {
        conflicts?: OfflineConflictView[];
        error?: string;
      };
      if (!response.ok || !payload.conflicts) {
        throw new Error(payload.error ?? "目前無法處理同步衝突。");
      }
      setConflicts(payload.conflicts);
      setResolutionById((current) => ({ ...current, [conflict.id]: "" }));
      setReasonById((current) => ({ ...current, [conflict.id]: "" }));
      setMessage("同步衝突已處理並寫入稽核紀錄。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法處理同步衝突。");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="border-t border-stone-200 pt-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldAlert className="h-5 w-5 text-orange-700" />
            同步衝突
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            衝突不會自動刪除；請核對正式訂單、付款或列印狀態後留下處理原因。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-stone-600">待處理 {openCount} 筆</span>
          <button
            type="button"
            title="重新載入同步衝突"
            disabled={busyId !== null}
            onClick={() => void refresh()}
            className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${busyId === "refresh" ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {message ? (
        <p role="status" className="mt-4 border-y border-stone-200 py-3 text-sm text-stone-700">
          {message}
        </p>
      ) : null}

      <div className="mt-5 space-y-4">
        {conflicts.map((conflict) => {
          const open = conflict.resolutionStatus === "OPEN";
          return (
            <article key={conflict.id} className="rounded-md border border-stone-300 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    {open
                      ? <CircleAlert className="h-4 w-4 text-orange-700" />
                      : <CheckCircle2 className="h-4 w-4 text-emerald-700" />}
                    {conflictLabels[conflict.conflictType] ?? conflict.conflictType}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {conflict.deviceName} · {formatTaipeiDateTime(conflict.detectedAt)}
                  </p>
                </div>
                <span className={`text-sm font-semibold ${open ? "text-orange-700" : "text-emerald-700"}`}>
                  {resolutionLabels[conflict.resolutionStatus] ?? conflict.resolutionStatus}
                </span>
              </div>
              <dl className="mt-3 grid gap-2 border-y border-stone-200 py-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-stone-500">資料類型</dt>
                  <dd>{entityLabel(conflict.localEntityType)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">正式訂單</dt>
                  <dd>{conflict.canonicalOrderNumber ?? "尚未建立"}</dd>
                </div>
                {Object.entries(conflict.details).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs text-stone-500">{detailLabel(key)}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
              {open ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] sm:items-end">
                  <label className="text-sm font-medium">
                    處理結果
                    <select
                      value={resolutionById[conflict.id] ?? ""}
                      disabled={busyId !== null}
                      onChange={(event) => setResolutionById((current) => ({
                        ...current,
                        [conflict.id]: event.target.value,
                      }))}
                      className="form-input mt-1"
                    >
                      <option value="">請選擇</option>
                      {resolutionOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    處理原因
                    <input
                      type="text"
                      value={reasonById[conflict.id] ?? ""}
                      maxLength={500}
                      disabled={busyId !== null}
                      onChange={(event) => setReasonById((current) => ({
                        ...current,
                        [conflict.id]: event.target.value,
                      }))}
                      className="form-input mt-1"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void resolveConflict(conflict)}
                    className="min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    確認處理
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-stone-500">
                  {conflict.resolvedBy ? `處理人：${conflict.resolvedBy}` : ""}
                  {conflict.resolvedAt ? ` · ${formatTaipeiDateTime(conflict.resolvedAt)}` : ""}
                </p>
              )}
            </article>
          );
        })}
      </div>
      {conflicts.length === 0 ? (
        <p className="mt-5 border-y border-stone-200 py-8 text-center text-sm text-stone-500">
          目前沒有同步衝突。
        </p>
      ) : null}
    </section>
  );
}

function entityLabel(value: string) {
  return ({
    ORDER: "訂單",
    CASH_EVENT: "現金異動",
    PRINT_JOB: "列印工作",
  } as Record<string, string>)[value] ?? value;
}

function detailLabel(value: string) {
  return ({
    errorCode: "錯誤代碼",
    menuSnapshotVersion: "菜單版本",
    promotionEpoch: "建立時後端世代",
    activePromotionEpoch: "目前後端世代",
  } as Record<string, string>)[value] ?? value;
}
