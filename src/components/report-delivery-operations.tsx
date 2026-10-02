"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { OPERATIONS_AUTH_INVALIDATED } from "@/lib/operations-query";
import { calendarDateInTimeZone, zonedCalendarDateRangeUtc } from "@/lib/date-time";
import { reportDeliveryListSchema, type ReportDeliverySummary } from "@/lib/report-delivery-contract";

const reasons: Record<string, string> = {
  EFFECT_OUTCOME_UNKNOWN: "供應商結果未知，已停止自動重送", EMAIL_RESPONSE_LOST: "連線中斷，尚無法確認供應商結果",
  EMAIL_RESPONSE_UNPROVEN: "供應商回應不足以確認結果", LEGACY_UNPROVEN: "舊工作缺少可驗證的執行紀錄，已隔離",
  WORKER_ATTEMPTS_EXHAUSTED: "已達 5 次上限，不再重試", LEASE_EXPIRED_BEFORE_EFFECT: "執行租約到期，確認尚未送出",
  REPORT_PRE_EFFECT_DENIED: "寄送前權限或設定已變更，已停止", PROVIDER_CONFIRMED_REJECTION: "已確認供應商未接受，可依目前權限重試",
  PROVIDER_BINDING_CHANGED: "供應商設定已變更，禁止沿用舊工作重送", EMAIL_PROVIDER_NOT_CONFIGURED: "寄送服務尚未設定",
};
const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "—";
function status(item: ReportDeliverySummary) {
  if (item.status === "SIMULATED") return "模擬接受（SIMULATED）";
  if (item.effectState === "ACCEPTED") return "供應商已接受";
  if (item.effectState === "UNKNOWN") return "結果未知・停止重送";
  if (item.effectState === "SUPPRESSED") return "已停止";
  if (item.status === "FAILURE") return "失敗／待處理";
  return item.leaseExpiresAt ? "執行中" : "等待執行";
}
export function ReportDeliveryOperations({ organizationId, timeZone }: { organizationId: string; timeZone: string }) {
  const [items, setItems] = useState<ReportDeliverySummary[]>([]), [outcome, setOutcome] = useState("ALL");
  const [dates, setDates] = useState(() => { const today = calendarDateInTimeZone(new Date(), timeZone); return { from: today, to: today }; });
  const [bounds, setBounds] = useState(() => zonedCalendarDateRangeUtc(dates.from, dates.to, timeZone));
  const [rangeError, setRangeError] = useState("");
  const [next, setNext] = useState<string | null>(null), [range, setRange] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState<string | null>(null);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const lifecycle = useRef(0), mutation = useRef<AbortController | null>(null);
  const [loadedFor, setLoadedFor] = useState(organizationId);
  const authority = useRef(true), [invalidated, setInvalidated] = useState(false);
  const invalidatePending = useCallback(() => {
    lifecycle.current++; sequence.current++;
    controller.current?.abort(); mutation.current?.abort();
  }, []);
  const deny = useCallback(() => {
    authority.current = false; invalidatePending();
    setItems([]); setRange(""); setNext(null); setBusy(null); setNotice(""); setError(""); setRangeError(""); setLoading(false); setInvalidated(true);
  }, [invalidatePending]);
  useLayoutEffect(() => {
    authority.current = true;
    window.addEventListener(OPERATIONS_AUTH_INVALIDATED, deny);
    return () => { authority.current = false; window.removeEventListener(OPERATIONS_AUTH_INVALIDATED, deny); };
  }, [organizationId, deny]);
  const load = useCallback(async (cursor?: string) => {
    if (!authority.current) return;
    const current = ++sequence.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError("");
    if (!cursor) { setItems([]); setRange(""); }
    try {
      const query = new URLSearchParams({ outcome, limit: "20", from: bounds.from.toISOString(), to: bounds.to.toISOString(), ...(cursor ? { cursor } : {}) });
      const response = await fetch(`/api/merchant/organizations/${organizationId}/report-deliveries?${query}`, { signal: abort.signal, cache: "no-store", credentials: "same-origin" });
      if (current !== sequence.current || abort.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { deny(); return; }
      if (!response.ok) throw new Error(response.status === 401 ? "登入已失效，請重新登入。" : response.status === 403 ? "目前沒有讀取報表工作的權限。" : "報表工作讀取失敗，請重試。");
      const result = reportDeliveryListSchema.parse(await response.json());
      if (current !== sequence.current) return;
      setLoadedFor(organizationId); setItems(previous => cursor ? [...previous, ...result.items] : result.items); setNext(result.nextCursor); setRange(`${time(result.from)} ～ ${time(result.to)}（不含結束時間）`);
    } catch (cause) { if (!abort.signal.aborted && current === sequence.current) { setItems([]); setNext(null); setError(cause instanceof Error ? cause.message : "報表工作讀取失敗，請重試。"); } }
    finally { if (current === sequence.current) setLoading(false); }
  }, [organizationId, outcome, bounds, deny]);
  useEffect(() => {
    lifecycle.current++; let cancelled = false;
    queueMicrotask(() => { if (!cancelled && authority.current) { setInvalidated(false); setNotice(""); setBusy(null); void load(); } });
    return () => { cancelled = true; invalidatePending(); };
  }, [load, invalidatePending]);
  async function mutate(item: ReportDeliverySummary, operation: "retry" | "reconcile") {
    if (!authority.current) return;
    const epoch = lifecycle.current, abort = new AbortController(); mutation.current = abort;
    setBusy(item.id); setNotice("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/report-deliveries/${item.id}/${operation}`, { method: "POST", signal: abort.signal, credentials: "same-origin", cache: "no-store", headers: csrfHeaders(), body: JSON.stringify({ expectedVersion: item.version, ...(operation === "retry" ? { reason: "RETRY_CONFIRMED_FAILURE" } : {}) }) });
      if (epoch !== lifecycle.current || abort.signal.aborted) return;
      if (response.status === 401) { deny(); return; }
      const result = await response.json();
      if (epoch !== lifecycle.current || abort.signal.aborted) return;
      if (!response.ok) { setNotice(typeof result.message === "string" ? result.message : "操作失敗，請重新讀取工作。"); if (response.status === 403 || response.status === 409) await load(); return; }
      setNotice(operation === "retry" ? "已排入重試，累計次數保留，最多 5 次。" : "已依可信供應商證據更新結果。"); await load();
    } catch { if (epoch === lifecycle.current && !abort.signal.aborted) setNotice("操作回應中斷，請重新讀取狀態後再操作。"); }
    finally { if (epoch === lifecycle.current) setBusy(null); }
  }
  if (invalidated) return <section aria-labelledby="report-operations-heading" className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6"><h2 id="report-operations-heading" className="text-xl font-semibold">報表工作與失敗處理</h2><p role="alert">登入或權限已變更，報表工作已清除。</p></section>;
  return <section aria-labelledby="report-operations-heading" className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">
    <div><h2 id="report-operations-heading" className="text-xl font-semibold">報表工作與失敗處理</h2><p className="mt-1 text-sm text-slate-600">「已接受」僅表示供應商接受請求，不代表送達或已讀。未知結果不會自動重送。</p></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      try {
        const selected = zonedCalendarDateRangeUtc(dates.from, dates.to, timeZone);
        if (selected.from >= selected.to || selected.to.getTime() - selected.from.getTime() > 90 * 86400000) throw new Error("INVALID_RANGE");
        setRangeError(""); setBounds(selected);
      } catch { setRangeError("請選擇有效的起訖日期，每次查詢最多 90 天；可縮短範圍後再查詢。"); }
    }}>
      <label className="grid min-w-0 gap-1 text-sm">開始日期<input aria-label="工作開始日期" type="date" required className="min-h-12 min-w-0 rounded-lg border px-3" value={dates.from} disabled={!!busy} onChange={event => { setRangeError(""); setDates(previous => ({ ...previous, from: event.target.value })); }} /></label>
      <label className="grid min-w-0 gap-1 text-sm">結束日期（含當日）<input aria-label="工作結束日期" type="date" required className="min-h-12 min-w-0 rounded-lg border px-3" value={dates.to} disabled={!!busy} onChange={event => { setRangeError(""); setDates(previous => ({ ...previous, to: event.target.value })); }} /></label>
      <button type="submit" className="min-h-12 rounded-lg border px-4 disabled:opacity-50" disabled={loading || !!busy}>套用日期範圍</button>
    </form>
    <p className="text-sm text-slate-500">日期依組織時區 {timeZone}，每次查詢最多 90 天。</p>
    {rangeError && <p role="alert">{rangeError}</p>}
    <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">工作狀態<select aria-label="工作狀態" className="min-h-12 rounded-lg border px-3" value={outcome} onChange={event => { setNotice(""); setOutcome(event.target.value); }} disabled={!!busy}><option value="ALL">全部</option><option value="FAILED">失敗／待處理</option><option value="UNKNOWN">結果未知</option></select></label><button type="button" className="min-h-12 rounded-lg border px-4 disabled:opacity-50" disabled={loading || !!busy} onClick={() => void load()}>重新讀取</button></div>
    {loadedFor === organizationId && range && <p className="text-sm text-slate-500">已套用的查詢範圍：{range}</p>}
    <div aria-live="polite" role="status">{loadedFor === organizationId ? notice : ""}</div>
    {loading && <p role="status">正在讀取報表工作…</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 p-4"><p>{error}</p><button className="mt-2 min-h-12 rounded-lg border px-4" onClick={() => void load()}>重試讀取</button></div>}
    {!loading && !error && items.length === 0 && <p className="rounded-lg border p-6">目前範圍內沒有報表工作。</p>}
    <ul className="space-y-3" aria-busy={loading}>
      {(loadedFor === organizationId ? items : []).map(item => <li key={item.id} data-report-id={item.id} className="space-y-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{status(item)}</h3><span>累計 {item.attempt}／{item.maxAttempts} 次 · 版本 {item.version}</span></div>
        {item.reason && <p>{reasons[item.reason] ?? "工作已停止或等待處理"} <code className="break-all text-xs">{item.reason}</code></p>}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">建立時間</dt><dd>{time(item.createdAt)}</dd></div><div><dt className="text-slate-500">最近執行</dt><dd>{time(item.startedAt)}</dd></div><div><dt className="text-slate-500">下次嘗試</dt><dd>{time(item.nextAttemptAt)}</dd></div><div><dt className="text-slate-500">租約到期</dt><dd>{time(item.leaseExpiresAt)}</dd></div><div><dt className="text-slate-500">供應商接受時間</dt><dd>{time(item.acceptedAt)}</dd></div><div><dt className="text-slate-500">最近核對</dt><dd>{time(item.reconciledAt)}</dd></div></dl>
        <p className="break-all text-xs text-slate-500">工作：{item.id}<br />追蹤編號：{item.requestId ?? "舊工作未提供"}</p>
        <div className="flex flex-wrap gap-3"><button className="min-h-12 rounded-lg border px-4 disabled:opacity-50" disabled={!item.canRetry || !!busy || loading} onClick={() => void mutate(item, "retry")}>重試已確認未接受的工作</button><button className="min-h-12 rounded-lg border px-4 disabled:opacity-50" disabled={!item.canReconcile || !!busy || loading} onClick={() => void mutate(item, "reconcile")}>核對供應商結果</button></div>
        {!item.canRetry && <p className="text-sm text-slate-500">僅具管理權限、未達上限且已有可信未接受證據的工作可重試。</p>}
        {item.effectState === "UNKNOWN" && <p className="text-sm">請由平台管理員核對供應商結果；無法取得可信證據時會維持停發。</p>}
      </li>)}
    </ul>
    {next && <button className="min-h-12 rounded-lg border px-4 disabled:opacity-50" disabled={loading || !!busy} onClick={() => void load(next)}>載入更多</button>}
  </section>;
}
