"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock3, Gauge, LoaderCircle, Pause, Play, RefreshCw, Save, X } from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import type { StaffCapacityData } from "@/lib/capacity-contract";
import { csrfHeaders } from "@/lib/csrf-client";
import { getOperationsErrorMessageKey } from "@/lib/messages/operations-errors";

export function StaffCapacityControl({
  stallSlug,
  initialData,
  compact = false,
}: {
  stallSlug: string;
  initialData: StaffCapacityData;
  compact?: boolean;
}) {
  const { t } = useOperationsLocale();
  const [data, setData] = useState(initialData);
  const [reason, setReason] = useState("");
  const [waitMinutes, setWaitMinutes] = useState(
    initialData.settings.manualWaitMinutes?.toString() ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  const refresh = useCallback(async (showMessage = false) => {
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/capacity`, {
        cache: "no-store",
      });
      const payload = await response.json() as StaffCapacityData & { code?: string };
      if (!response.ok) throw new Error(t(getOperationsErrorMessageKey(payload.code, "capacity.dataFailed")));
      setData(payload);
      setWaitMinutes(payload.settings.manualWaitMinutes?.toString() ?? "");
      if (showMessage) {
        setMessage(t("capacity.dataUpdated"));
        setMessageIsError(false);
      }
    } catch (error) {
      if (showMessage) {
        setMessage(error instanceof Error ? error.message : t("capacity.dataFailed"));
        setMessageIsError(true);
      }
    }
  }, [stallSlug, t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(false);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function mutate(command: Record<string, unknown>, successMessage: string) {
    if (!(typeof command.reason === "string" && command.reason.trim().length >= 3)) {
      setMessage(t("capacity.reasonRequired"));
      setMessageIsError(true);
      return;
    }
    setBusy(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/capacity`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as StaffCapacityData & { code?: string };
      if (!response.ok) throw new Error(t(getOperationsErrorMessageKey(payload.code, "capacity.settingsFailed")));
      setData(payload);
      setWaitMinutes(payload.settings.manualWaitMinutes?.toString() ?? "");
      setMessage(successMessage);
      setMessageIsError(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("capacity.settingsFailed"));
      setMessageIsError(true);
    } finally {
      setBusy(false);
    }
  }

  const snapshot = data.snapshot;
  const paused = snapshot.pauseSource !== "NONE" || !snapshot.acceptingPublicOrders;
  const warning = snapshot.utilizationPercent >= snapshot.warningUtilizationPercent;
  const quotedWait = snapshot.quoteMinMinutes === snapshot.quoteMaxMinutes
    ? t("capacity.minutes", { minutes: snapshot.quoteMaxMinutes })
    : t("capacity.range", { min: snapshot.quoteMinMinutes, max: snapshot.quoteMaxMinutes });
  const summaryStatus = `${quotedWait} · ${Math.round(snapshot.utilizationPercent)}% · ${paused ? t("capacity.paused") : t("capacity.accepting")}`;

  return (
    <details
      data-testid={compact ? "staff-capacity-compact" : undefined}
      className={compact ? "relative shrink-0 print:hidden" : "mt-5 border-y border-stone-200 py-3 print:hidden"}
      open={compact ? undefined : paused || warning || Boolean(message)}
    >
      <summary
        title={t("capacity.title")}
        aria-label={`${t("capacity.title")} · ${summaryStatus}`}
        className={compact
          ? `relative grid h-11 w-11 cursor-pointer list-none place-items-center rounded-md border ${paused ? "border-red-600 bg-red-50 text-red-700" : warning ? "border-amber-500 bg-amber-50 text-amber-700" : "border-stone-300 bg-white text-teal-800"}`
          : "flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-3"}
      >
        {compact ? (
          <>
            <Gauge className="h-5 w-5" />
            <span className="sr-only">{t("capacity.title")} · {summaryStatus}</span>
            {paused || warning ? <span aria-hidden="true" className={`absolute right-1 top-1 h-2 w-2 rounded-full ${paused ? "bg-red-600" : "bg-amber-500"}`} /> : null}
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-2 font-semibold">
              <Gauge className="h-5 w-5 text-teal-700" />{t("capacity.title")}
            </span>
            <span className={`inline-flex items-center gap-2 text-sm font-semibold ${paused ? "text-red-700" : warning ? "text-amber-700" : "text-stone-600"}`}>
              {warning ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
              {summaryStatus}
            </span>
          </>
        )}
      </summary>

      <div className={compact
        ? "fixed inset-x-4 top-20 z-50 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-lg border border-stone-300 bg-white p-4 shadow-xl sm:inset-x-auto sm:left-1/2 sm:w-[min(92vw,42rem)] sm:-translate-x-1/2"
        : "border-t border-stone-200 pt-5"}
      >
        {compact ? (
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-stone-200 pb-3">
            <div>
              <h2 className="font-semibold">{t("capacity.title")}</h2>
              <p className={`mt-1 text-xs font-semibold ${paused ? "text-red-700" : warning ? "text-amber-700" : "text-stone-600"}`}>{summaryStatus}</p>
            </div>
            <button
              type="button"
              title={t("common.close")}
              aria-label={t("common.close")}
              onClick={(event) => {
                const details = event.currentTarget.closest("details");
                if (details) details.open = false;
              }}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Metric label={t("capacity.load")} value={`${Math.round(snapshot.utilizationPercent)}%`} />
              <Metric label={t("capacity.activeOrders")} value={String(snapshot.orderCount)} />
              <Metric label={t("capacity.activeItems")} value={String(snapshot.itemCount)} />
            </div>
            <label className="mt-4 block text-sm font-medium">
              {t("capacity.reason")}
              <input type="text"
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("capacity.reasonPlaceholder")}
                className="form-input mt-1"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {paused ? (
                <button type="button" disabled={busy} onClick={() => void mutate({ operation: "RESUME_ORDERING", reason }, t("capacity.resumed"))} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />{t("capacity.resume")}</button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void mutate({ operation: "PAUSE_ORDERING", reason }, t("capacity.pausedDone"))} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50"><Pause className="h-4 w-4" />{t("capacity.pause")}</button>
              )}
              {data.capabilities.automaticControl ? (
                <button type="button" disabled={busy} onClick={() => void mutate({ operation: "SET_AUTO_PAUSE", enabled: !data.settings.autoPauseEnabled, reason }, data.settings.autoPauseEnabled ? t("capacity.autoOff") : t("capacity.autoOn"))} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50">{t("capacity.autoPause", { state: data.settings.autoPauseEnabled ? t("common.on") : t("common.off") })}</button>
              ) : null}
              <button type="button" disabled={busy} title={t("capacity.refresh")} onClick={() => void refresh(true)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><RefreshCw className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="border-t border-stone-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <label className="text-sm font-medium">
              {t("capacity.manualWait")}
              <input
                type="number"
                min={0}
                max={480}
                value={waitMinutes}
                onChange={(event) => setWaitMinutes(event.target.value)}
                placeholder={t("capacity.autoPlaceholder")}
                className="form-input mt-1"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || (waitMinutes !== "" && (!Number.isInteger(Number(waitMinutes)) || Number(waitMinutes) < 0 || Number(waitMinutes) > 480))}
                onClick={() => void mutate({ operation: "SET_WAIT_OVERRIDE", minutes: waitMinutes === "" ? null : Number(waitMinutes), reason }, waitMinutes === "" ? t("capacity.autoRestored") : t("capacity.manualUpdated"))}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("common.apply")}
              </button>
              {data.settings.manualWaitMinutes !== null ? (
                <button type="button" disabled={busy} onClick={() => { setWaitMinutes(""); void mutate({ operation: "SET_WAIT_OVERRIDE", minutes: null, reason }, t("capacity.autoRestored")); }} className="min-h-10 rounded-md border border-stone-300 px-3 text-sm font-semibold">{t("capacity.clearOverride")}</button>
              ) : null}
            </div>
          </div>
        </div>
        {message ? <p role="status" className={`mt-4 text-sm ${messageIsError ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border-r border-stone-200 px-2 last:border-r-0"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}
