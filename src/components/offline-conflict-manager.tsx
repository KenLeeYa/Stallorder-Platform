"use client";

import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, RefreshCw, ShieldAlert } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppDateTime } from "@/lib/locale-format";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
} from "@/lib/form-field-errors";

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
  const { locale, m, label } = useMerchantMessages();
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [resolutionById, setResolutionById] = useState<Record<string, string>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const sectionRef = useRef<HTMLElement>(null);
  const openCount = useMemo(
    () => conflicts.filter((conflict) => conflict.resolutionStatus === "OPEN").length,
    [conflicts],
  );

  function fieldKey(conflictId: string, field: string) {
    return `${conflictId}:${field}`;
  }

  function clearFieldError(conflictId: string, field: string) {
    setFieldErrors((current) => withoutFieldError(current, fieldKey(conflictId, field)));
  }

  async function refresh() {
    setBusyId("refresh");
    setMessage("");
    setHasError(false);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/offline/conflicts`, {
        cache: "no-store",
      });
      const payload = await response.json() as {
        conflicts?: OfflineConflictView[];
        error?: string;
      };
      if (!response.ok || !payload.conflicts) {
        throw new Error(payload.error ?? label("目前無法重新載入同步衝突。"));
      }
      setConflicts(payload.conflicts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("目前無法重新載入同步衝突。"));
      setHasError(true);
    } finally {
      setBusyId(null);
    }
  }

  async function resolveConflict(conflict: OfflineConflictView) {
    const resolutionStatus = resolutionById[conflict.id] ?? "";
    const reason = reasonById[conflict.id]?.trim() ?? "";
    if (
      ["REJECTED", "CANCELLED"].includes(resolutionStatus)
      && !window.confirm(label("確定套用此處理結果？系統會保留稽核紀錄，送出後不可直接復原。"))
    ) {
      return;
    }

    setBusyId(conflict.id);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
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
        fieldErrors?: unknown;
      };
      if (!response.ok || !payload.conflicts) {
        const parsedFieldErrors = parseFieldErrors(payload.fieldErrors);
        const nextFieldErrors = Object.fromEntries(Object.entries(parsedFieldErrors).map(([field, error]) => [fieldKey(conflict.id, field), error]));
        setFieldErrors(nextFieldErrors);
        setMessage(payload.error ?? label("目前無法處理同步衝突。"));
        setHasError(true);
        focusFirstInvalidField(sectionRef.current, nextFieldErrors);
        return;
      }
      setConflicts(payload.conflicts);
      setResolutionById((current) => ({ ...current, [conflict.id]: "" }));
      setReasonById((current) => ({ ...current, [conflict.id]: "" }));
      setMessage(label("同步衝突已處理並寫入稽核紀錄。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("目前無法處理同步衝突。"));
      setHasError(true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section ref={sectionRef} className="border-t border-stone-200 pt-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldAlert className="h-5 w-5 text-orange-700" />
            {label("同步衝突")}
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            {label("衝突不會自動刪除；請核對正式訂單、付款或列印狀態後留下處理原因。")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-stone-600">{label("待處理")} {openCount} {label("筆")}</span>
          <button
            type="button"
            title={label("重新載入同步衝突")}
            disabled={busyId !== null}
            onClick={() => void refresh()}
            className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${busyId === "refresh" ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {message ? (
        <p role={hasError ? "alert" : "status"} className={`mt-4 border-y py-3 text-sm ${hasError ? "border-red-200 text-red-700" : "border-stone-200 text-stone-700"}`}>
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
                    {label(conflictLabels[conflict.conflictType] ?? conflict.conflictType)}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {conflict.deviceName} · {formatAppDateTime(locale, conflict.detectedAt, { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <span className={`text-sm font-semibold ${open ? "text-orange-700" : "text-emerald-700"}`}>
                  {label(resolutionLabels[conflict.resolutionStatus] ?? conflict.resolutionStatus)}
                </span>
              </div>
              <dl className="mt-3 grid gap-2 border-y border-stone-200 py-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-stone-500">{label("資料類型")}</dt>
                  <dd>{label(entityLabel(conflict.localEntityType))}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">{label("正式訂單")}</dt>
                  <dd>{conflict.canonicalOrderNumber ?? label("尚未建立")}</dd>
                </div>
                {Object.entries(conflict.details).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs text-stone-500">{label(detailLabel(key))}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
              {open ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] sm:items-end">
                  <label className="text-sm font-medium">
                    {label("處理結果")}
                    <select
                      value={resolutionById[conflict.id] ?? ""}
                      data-field-key={fieldKey(conflict.id, "resolutionStatus")}
                      aria-invalid={Boolean(fieldErrors[fieldKey(conflict.id, "resolutionStatus")])}
                      aria-describedby={fieldErrors[fieldKey(conflict.id, "resolutionStatus")] ? fieldErrorId(conflict.id, "resolutionStatus") : undefined}
                      disabled={busyId !== null}
                      onChange={(event) => {
                        clearFieldError(conflict.id, "resolutionStatus");
                        setResolutionById((current) => ({
                          ...current,
                          [conflict.id]: event.target.value,
                        }));
                      }}
                      className={`form-input mt-1 ${fieldErrors[fieldKey(conflict.id, "resolutionStatus")] ? "border-red-500 bg-red-50" : ""}`}
                    >
                      <option value="">{label("請選擇")}</option>
                      {resolutionOptions.map((option) => (
                        <option key={option.value} value={option.value}>{label(option.label)}</option>
                      ))}
                    </select>
                    {fieldErrors[fieldKey(conflict.id, "resolutionStatus")] ? <FieldError id={fieldErrorId(conflict.id, "resolutionStatus")} error={fieldErrors[fieldKey(conflict.id, "resolutionStatus")]} /> : null}
                  </label>
                  <label className="text-sm font-medium">
                    {label("處理原因")}
                    <input
                      type="text"
                      value={reasonById[conflict.id] ?? ""}
                      minLength={5}
                      maxLength={500}
                      data-field-key={fieldKey(conflict.id, "reason")}
                      aria-invalid={Boolean(fieldErrors[fieldKey(conflict.id, "reason")])}
                      aria-describedby={fieldErrors[fieldKey(conflict.id, "reason")] ? fieldErrorId(conflict.id, "reason") : undefined}
                      disabled={busyId !== null}
                      onChange={(event) => {
                        clearFieldError(conflict.id, "reason");
                        setReasonById((current) => ({
                          ...current,
                          [conflict.id]: event.target.value,
                        }));
                      }}
                      className={`form-input mt-1 ${fieldErrors[fieldKey(conflict.id, "reason")] ? "border-red-500 bg-red-50" : ""}`}
                    />
                    {fieldErrors[fieldKey(conflict.id, "reason")] ? <FieldError id={fieldErrorId(conflict.id, "reason")} error={fieldErrors[fieldKey(conflict.id, "reason")]} /> : null}
                  </label>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void resolveConflict(conflict)}
                    className="min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {label("確認處理")}
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-stone-500">
                  {conflict.resolvedBy ? m("處理人：{value0}", { value0: conflict.resolvedBy }) : ""}
                  {conflict.resolvedAt ? ` · ${formatAppDateTime(locale, conflict.resolvedAt, { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" })}` : ""}
                </p>
              )}
            </article>
          );
        })}
      </div>
      {conflicts.length === 0 ? (
        <p className="mt-5 border-y border-stone-200 py-8 text-center text-sm text-stone-500">
          {label("目前沒有同步衝突。")}
        </p>
      ) : null}
    </section>
  );
}

function FieldError({ id, error }: { id: string; error: string }) {
  return <span id={id} role="alert" className="mt-1 block text-xs text-red-700">{error}</span>;
}

function fieldErrorId(conflictId: string, field: string) {
  return `offline-conflict-${conflictId}-${field}-error`;
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
