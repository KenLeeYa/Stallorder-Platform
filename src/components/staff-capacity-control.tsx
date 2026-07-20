"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock3, Gauge, LoaderCircle, Pause, Play, RefreshCw, Save } from "lucide-react";
import type { StaffCapacityData } from "@/lib/capacity-contract";
import { csrfHeaders } from "@/lib/csrf-client";

export function StaffCapacityControl({
  stallSlug,
  initialData,
}: {
  stallSlug: string;
  initialData: StaffCapacityData;
}) {
  const [data, setData] = useState(initialData);
  const [reason, setReason] = useState("");
  const [waitMinutes, setWaitMinutes] = useState(
    initialData.settings.manualWaitMinutes?.toString() ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (showMessage = false) => {
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/capacity`, {
        cache: "no-store",
      });
      const payload = await response.json() as StaffCapacityData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "無法更新產能資料。");
      setData(payload);
      setWaitMinutes(payload.settings.manualWaitMinutes?.toString() ?? "");
      if (showMessage) setMessage("產能資料已更新。");
    } catch (error) {
      if (showMessage) setMessage(error instanceof Error ? error.message : "無法更新產能資料。");
    }
  }, [stallSlug]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(false);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function mutate(command: Record<string, unknown>, successMessage: string) {
    if (!(typeof command.reason === "string" && command.reason.trim().length >= 3)) {
      setMessage("請先填寫至少 3 個字的操作原因。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/capacity`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as StaffCapacityData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "無法更新產能設定。");
      setData(payload);
      setWaitMinutes(payload.settings.manualWaitMinutes?.toString() ?? "");
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法更新產能設定。");
    } finally {
      setBusy(false);
    }
  }

  const snapshot = data.snapshot;
  const paused = snapshot.pauseSource !== "NONE" || !snapshot.acceptingPublicOrders;
  const warning = snapshot.utilizationPercent >= snapshot.warningUtilizationPercent;

  return (
    <details className="mt-5 border-y border-stone-200 py-3 print:hidden" open={paused || warning || Boolean(message)}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-semibold">
          <Gauge className="h-5 w-5 text-teal-700" />產能與等候時間
        </span>
        <span className={`inline-flex items-center gap-2 text-sm font-semibold ${paused ? "text-red-700" : warning ? "text-amber-700" : "text-stone-600"}`}>
          {warning ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
          {snapshot.quoteMinMinutes === snapshot.quoteMaxMinutes
            ? `${snapshot.quoteMaxMinutes} 分鐘`
            : `${snapshot.quoteMinMinutes}～${snapshot.quoteMaxMinutes} 分鐘`}
          · {Math.round(snapshot.utilizationPercent)}%
          · {paused ? "公開接單暫停" : "公開接單中"}
        </span>
      </summary>

      <div className="grid gap-5 border-t border-stone-200 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Metric label="負載" value={`${Math.round(snapshot.utilizationPercent)}%`} />
            <Metric label="製作中訂單" value={String(snapshot.orderCount)} />
            <Metric label="製作中品項" value={String(snapshot.itemCount)} />
          </div>
          <label className="mt-4 block text-sm font-medium">
            操作原因
            <input
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：現場人力不足、恢復正常"
              className="form-input mt-1"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {paused ? (
              <button type="button" disabled={busy} onClick={() => void mutate({ operation: "RESUME_ORDERING", reason }, "已恢復公開接單。") } className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />恢復接單</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void mutate({ operation: "PAUSE_ORDERING", reason }, "已暫停公開接單。") } className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50"><Pause className="h-4 w-4" />暫停接單</button>
            )}
            {data.capabilities.automaticControl ? (
              <button type="button" disabled={busy} onClick={() => void mutate({ operation: "SET_AUTO_PAUSE", enabled: !data.settings.autoPauseEnabled, reason }, data.settings.autoPauseEnabled ? "已關閉自動暫停。" : "已開啟自動暫停。") } className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50">自動暫停：{data.settings.autoPauseEnabled ? "開" : "關"}</button>
            ) : null}
            <button type="button" disabled={busy} title="重新整理產能" onClick={() => void refresh(true)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><RefreshCw className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="border-t border-stone-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <label className="text-sm font-medium">
            手動等候時間（分鐘）
            <input
              type="number"
              min={0}
              max={480}
              value={waitMinutes}
              onChange={(event) => setWaitMinutes(event.target.value)}
              placeholder="留空使用自動計算"
              className="form-input mt-1"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || (waitMinutes !== "" && (!Number.isInteger(Number(waitMinutes)) || Number(waitMinutes) < 0 || Number(waitMinutes) > 480))}
              onClick={() => void mutate({ operation: "SET_WAIT_OVERRIDE", minutes: waitMinutes === "" ? null : Number(waitMinutes), reason }, waitMinutes === "" ? "已恢復自動估算。" : "已更新手動等候時間。")}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              套用
            </button>
            {data.settings.manualWaitMinutes !== null ? (
              <button type="button" disabled={busy} onClick={() => { setWaitMinutes(""); void mutate({ operation: "SET_WAIT_OVERRIDE", minutes: null, reason }, "已恢復自動估算。"); }} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">清除覆寫</button>
            ) : null}
          </div>
        </div>
      </div>
      {message ? <p role="status" className={`mt-4 text-sm ${/(無法|請先|失敗)/.test(message) ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border-r border-stone-200 px-2 last:border-r-0"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}
