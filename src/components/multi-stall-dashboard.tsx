"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpDown,
  Banknote,
  CircleAlert,
  CircleCheck,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  TriangleAlert,
  WalletCards,
  Wifi,
  WifiOff,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";
import { createOptionalSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

type StallOption = {
  id: string;
  name: string;
  slug: string;
  code: string;
  businessStatus: "OPEN" | "PAUSED" | "CLOSED" | "SOLD_OUT";
  isActive: boolean;
};
type StallMetric = {
  stallId: string;
  stallName: string;
  stallSlug: string;
  stallCode: string;
  businessStatus: StallOption["businessStatus"];
  orderingEnabled: boolean;
  totalSales: number;
  orderCount: number;
  completedOrderCount: number;
  cancelledOrderCount: number;
  averageOrderValue: number;
  pendingOrderCount: number;
  unpaidOrderCount: number;
  cancellationRate: number;
  lastOrderAt: string | null;
};
type Overview = {
  generatedAt: string;
  summary: Omit<StallMetric, "stallId" | "stallName" | "stallSlug" | "stallCode" | "businessStatus" | "orderingEnabled" | "lastOrderAt"> & {
    openStallCount: number;
    pausedStallCount: number;
    closedStallCount: number;
    cashAmount: number;
    manualTransferAmount: number;
    otherPaymentAmount: number;
    bestPerformingStall: { stallId: string; stallName: string; totalSales: number } | null;
    busiestStall: { stallId: string; stallName: string; orderCount: number } | null;
  };
  stalls: StallMetric[];
  alerts: Array<{
    id: string;
    stallId: string;
    stallName: string;
    alertType: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
    status: "ACTIVE" | "ACKNOWLEDGED";
    detectedAt: string;
  }>;
};
type DatePreset = "TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "CUSTOM";
type SortKey = "sales" | "orders" | "pending" | "name";
type BatchAction = "PAUSE" | "RESUME";
type RealtimeState = "CONNECTING" | "LIVE" | "FALLBACK";

const statusLabels = { OPEN: "營業中", PAUSED: "已暫停", CLOSED: "已關閉", SOLD_OUT: "全攤售罄" } as const;

export function MultiStallDashboard({
  organizationId,
  organizationName,
  currency,
  stalls,
  canManageOrdering,
  initialSelectedStallIds,
}: {
  organizationId: string;
  organizationName: string;
  currency: string;
  stalls: StallOption[];
  canManageOrdering: boolean;
  initialSelectedStallIds?: string[];
}) {
  const today = useMemo(() => taipeiToday(), []);
  const [preset, setPreset] = useState<DatePreset>("TODAY");
  const [dateRange, setDateRange] = useState({ dateFrom: today, dateTo: today });
  const [selectedStallIds, setSelectedStallIds] = useState(
    initialSelectedStallIds?.length ? initialSelectedStallIds : stalls.filter((stall) => stall.isActive).map((stall) => stall.id),
  );
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sales");
  const [realtimeState, setRealtimeState] = useState<RealtimeState>(() => (
    isSupabaseBrowserConfigured() ? "CONNECTING" : "FALLBACK"
  ));
  const [pendingBatchAction, setPendingBatchAction] = useState<BatchAction | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [controlMessage, setControlMessage] = useState("");
  const [updatingAlertId, setUpdatingAlertId] = useState<string | null>(null);

  const loadOverview = useCallback(async (quiet = false) => {
    if (selectedStallIds.length === 0) {
      setError("請至少選擇一個攤位。");
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    setError("");
    try {
      const search = new URLSearchParams({
        organizationId,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      });
      selectedStallIds.forEach((stallId) => search.append("stallId", stallId));
      const response = await fetch(`/api/merchant/dashboard/overview?${search}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法載入儀表板。");
      setOverview(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "網路連線中斷，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }, [dateRange, organizationId, selectedStallIds]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadOverview(), 0);
    const polling = window.setInterval(() => void loadOverview(true), 45_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(polling);
    };
  }, [loadOverview]);

  useEffect(() => {
    const supabase = createOptionalSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`organization:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "operational_events",
          filter: `organization_id=eq.${organizationId}`,
        },
        () => void loadOverview(true),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "operational_alerts",
          filter: `organization_id=eq.${organizationId}`,
        },
        () => void loadOverview(true),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeState("LIVE");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeState("FALLBACK");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadOverview, organizationId]);

  async function executeBatchAction() {
    if (!pendingBatchAction || selectedStallIds.length === 0) return;
    setBatchRunning(true);
    setControlMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/stalls/batch-ordering`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          action: pendingBatchAction,
          stallIds: selectedStallIds,
          confirmation: "CONFIRM_BATCH_ACTION",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法執行批次操作。");
      setControlMessage(`已${pendingBatchAction === "PAUSE" ? "暫停" : "恢復"} ${payload.updatedCount} 個攤位。`);
      setPendingBatchAction(null);
      await loadOverview(true);
    } catch (requestError) {
      setControlMessage(requestError instanceof Error ? requestError.message : "目前無法執行批次操作。");
    } finally {
      setBatchRunning(false);
    }
  }

  async function acknowledgeAlert(alertId: string) {
    setUpdatingAlertId(alertId);
    setControlMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/alerts/${alertId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ status: "ACKNOWLEDGED" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法確認警示。");
      await loadOverview(true);
    } catch (requestError) {
      setControlMessage(requestError instanceof Error ? requestError.message : "目前無法確認警示。");
    } finally {
      setUpdatingAlertId(null);
    }
  }

  function choosePreset(nextPreset: DatePreset) {
    setPreset(nextPreset);
    if (nextPreset !== "CUSTOM") setDateRange(presetRange(nextPreset, today));
  }

  function toggleStall(stallId: string) {
    setSelectedStallIds((current) => current.includes(stallId)
      ? current.filter((id) => id !== stallId)
      : [...current, stallId]);
  }

  const visibleStalls = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-TW");
    return [...(overview?.stalls ?? [])]
      .filter((stall) => !normalized || `${stall.stallName} ${stall.stallCode}`.toLocaleLowerCase("zh-TW").includes(normalized))
      .sort((left, right) => {
        if (sortKey === "name") return left.stallName.localeCompare(right.stallName, "zh-TW");
        if (sortKey === "orders") return right.orderCount - left.orderCount;
        if (sortKey === "pending") return right.pendingOrderCount - left.pendingOrderCount;
        return right.totalSales - left.totalSales;
      });
  }, [overview, query, sortKey]);

  const summary = overview?.summary;
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <div className="border-b border-stone-200 pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-sm font-semibold text-teal-800">多攤位營運總覽</p><h1 className="mt-1 text-3xl font-semibold">{organizationName}</h1><p className="mt-2 text-sm text-stone-600">依攤位時區彙整的銷售、訂單與付款資料。</p></div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex min-h-10 items-center gap-2 text-xs font-medium ${realtimeState === "LIVE" ? "text-emerald-700" : "text-amber-700"}`} title={realtimeState === "LIVE" ? "Supabase Realtime 已連線" : "即時連線未就緒，使用 45 秒自動更新備援"}>
              {realtimeState === "LIVE" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              {realtimeState === "LIVE" ? "即時更新中" : realtimeState === "CONNECTING" ? "即時連線中" : "自動更新中"}
            </span>
            <button type="button" disabled={loading} onClick={() => void loadOverview()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />重新整理</button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,420px)]">
          <div>
            <div className="flex flex-wrap gap-1" aria-label="日期範圍">
              {([[
                "TODAY", "今天"], ["YESTERDAY", "昨天"], ["WEEK", "本週"], ["MONTH", "本月"], ["CUSTOM", "自訂"]] as [DatePreset, string][]).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={preset === value} onClick={() => choosePreset(value)} className={`min-h-10 rounded-md px-3 text-sm font-semibold ${preset === value ? "bg-stone-900 text-white" : "border border-stone-300 bg-white"}`}>{label}</button>
              ))}
            </div>
            {preset === "CUSTOM" ? <div className="mt-3 flex flex-wrap gap-3"><label className="text-sm text-stone-600">開始日期<input type="date" value={dateRange.dateFrom} onChange={(event) => setDateRange((current) => ({ ...current, dateFrom: event.target.value }))} className="ml-2 rounded-md border border-stone-300 px-2 py-2 text-stone-900" /></label><label className="text-sm text-stone-600">結束日期<input type="date" value={dateRange.dateTo} onChange={(event) => setDateRange((current) => ({ ...current, dateTo: event.target.value }))} className="ml-2 rounded-md border border-stone-300 px-2 py-2 text-stone-900" /></label></div> : <p className="mt-3 text-sm text-stone-600">{dateRange.dateFrom} 至 {dateRange.dateTo}</p>}
          </div>
          <details className="border-y border-stone-200 py-2">
            <summary className="cursor-pointer list-none py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">攤位範圍 · 已選 {selectedStallIds.length} 個</summary>
            <label className="flex min-h-10 items-center gap-2 border-t border-stone-100 text-sm"><input type="checkbox" checked={stalls.length > 0 && stalls.every((stall) => selectedStallIds.includes(stall.id))} onChange={(event) => setSelectedStallIds(event.target.checked ? stalls.map((stall) => stall.id) : [])} />全部攤位</label>
            {stalls.map((stall) => <label key={stall.id} className="flex min-h-10 items-center gap-2 border-t border-stone-100 text-sm"><input type="checkbox" checked={selectedStallIds.includes(stall.id)} onChange={() => toggleStall(stall.id)} />{stall.name}</label>)}
          </details>
        </div>
        {canManageOrdering ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
            <button type="button" disabled={selectedStallIds.length === 0 || batchRunning} onClick={() => setPendingBatchAction("PAUSE")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-300 px-3 text-sm font-semibold text-amber-900 disabled:opacity-50"><Pause className="h-4 w-4" />暫停已選攤位</button>
            <button type="button" disabled={selectedStallIds.length === 0 || batchRunning} onClick={() => setPendingBatchAction("RESUME")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50"><Play className="h-4 w-4" />恢復已選攤位</button>
            <span className="text-xs text-stone-500">操作範圍：{selectedStallIds.length} 個攤位</span>
          </div>
        ) : null}
      </div>

      {error ? <div role="alert" className="mt-5 flex items-center gap-2 border-y border-red-200 py-3 text-sm font-medium text-red-800"><CircleAlert className="h-4 w-4" />{error}</div> : null}
      {controlMessage ? <p role="status" className="mt-4 border-y border-stone-200 py-3 text-sm font-medium text-stone-700">{controlMessage}</p> : null}
      {loading && !overview ? <p className="py-12 text-center text-sm text-stone-500">正在載入營運資料...</p> : null}

      {overview?.alerts.length ? (
        <section className="border-b border-stone-200 py-5" aria-labelledby="operational-alerts-title">
          <div className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-amber-700" /><h2 id="operational-alerts-title" className="text-lg font-semibold">營運警示</h2></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {overview.alerts.map((alert) => (
              <article key={alert.id} className={`border-l-4 bg-stone-50 p-4 ${alert.severity === "CRITICAL" ? "border-red-600" : "border-amber-500"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-sm font-semibold">{alert.stallName}</p><p className="mt-1 text-sm text-stone-700">{alert.message}</p></div>
                  {alert.status === "ACTIVE" && canManageOrdering ? <button type="button" disabled={updatingAlertId === alert.id} onClick={() => void acknowledgeAlert(alert.id)} className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-xs font-semibold disabled:opacity-50">{updatingAlertId === alert.id ? "處理中..." : "確認收到"}</button> : <span className="text-xs font-medium text-stone-500">已確認</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {summary ? <>
        <section className="grid border-b border-stone-200 sm:grid-cols-2 lg:grid-cols-4" aria-label="營運摘要">
          <Metric icon={<Banknote />} label="總銷售額" value={formatMoney(summary.totalSales, currency)} />
          <Metric icon={<ShoppingBag />} label="訂單總數" value={String(summary.orderCount)} />
          <Metric icon={<CircleCheck />} label="已完成訂單" value={String(summary.completedOrderCount)} />
          <Metric icon={<WalletCards />} label="平均客單價" value={formatMoney(summary.averageOrderValue, currency)} />
          <Metric icon={<Clock3 />} label="待處理訂單" value={String(summary.pendingOrderCount)} />
          <Metric icon={<CircleAlert />} label="未付款訂單" value={String(summary.unpaidOrderCount)} />
          <Metric icon={<Store />} label="營業 / 暫停 / 關閉" value={`${summary.openStallCount} / ${summary.pausedStallCount} / ${summary.closedStallCount}`} />
          <Metric icon={<ArrowUpDown />} label="取消率" value={percent(summary.cancellationRate)} />
        </section>

        <section className="grid gap-5 border-b border-stone-200 py-5 sm:grid-cols-2">
          <div><p className="text-sm text-stone-500">最佳銷售攤位</p><p className="mt-1 font-semibold">{summary.bestPerformingStall ? `${summary.bestPerformingStall.stallName} · ${formatMoney(summary.bestPerformingStall.totalSales, currency)}` : "尚無完成銷售"}</p></div>
          <div><p className="text-sm text-stone-500">最忙碌攤位</p><p className="mt-1 font-semibold">{summary.busiestStall ? `${summary.busiestStall.stallName} · ${summary.busiestStall.orderCount} 筆訂單` : "尚無訂單"}</p></div>
        </section>

        <section className="py-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold">攤位比較</h2><p className="mt-1 text-xs text-stone-500">更新時間 {new Date(overview.generatedAt).toLocaleString("zh-TW")}</p></div><div className="flex gap-2"><label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" /><input aria-label="搜尋攤位" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋攤位" className="h-10 rounded-md border border-stone-300 pl-9 pr-3 text-sm" /></label><select aria-label="排序攤位" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="h-10 rounded-md border border-stone-300 bg-white px-2 text-sm"><option value="sales">銷售額</option><option value="orders">訂單數</option><option value="pending">待處理</option><option value="name">攤位名稱</option></select></div></div>

          <div className="mt-4 hidden md:block">
            <table className="w-full table-fixed border-y border-stone-200 text-left text-xs"><thead className="text-stone-500"><tr><th className="w-[15%] py-3">攤位</th><th>狀態</th><th>訂單</th><th>完成</th><th>銷售額</th><th>客單價</th><th>待處理</th><th>未付款</th><th>取消率</th><th className="w-[13%]">最後訂單</th></tr></thead><tbody>{visibleStalls.map((stall) => <tr key={stall.stallId} className="border-t border-stone-100"><td className="py-4 pr-2"><Link href={`/merchant/stalls/${stall.stallId}/dashboard`} className="font-semibold text-teal-800">{stall.stallName}</Link><div className="mt-1 text-stone-400">{stall.stallCode}</div></td><td><Status status={stall.businessStatus} /></td><td>{stall.orderCount}</td><td>{stall.completedOrderCount}</td><td>{formatMoney(stall.totalSales, currency)}</td><td>{formatMoney(stall.averageOrderValue, currency)}</td><td>{stall.pendingOrderCount}</td><td>{stall.unpaidOrderCount}</td><td>{percent(stall.cancellationRate)}</td><td>{stall.lastOrderAt ? new Date(stall.lastOrderAt).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}</td></tr>)}</tbody></table>
          </div>
          <div className="mt-4 grid gap-3 md:hidden">{visibleStalls.map((stall) => <article key={stall.stallId} className="rounded-md border border-stone-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><Link href={`/merchant/stalls/${stall.stallId}/dashboard`} className="font-semibold text-teal-800">{stall.stallName}</Link><Status status={stall.businessStatus} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><MobileMetric label="銷售額" value={formatMoney(stall.totalSales, currency)} /><MobileMetric label="訂單 / 完成" value={`${stall.orderCount} / ${stall.completedOrderCount}`} /><MobileMetric label="待處理 / 未付款" value={`${stall.pendingOrderCount} / ${stall.unpaidOrderCount}`} /><MobileMetric label="客單價 / 取消率" value={`${formatMoney(stall.averageOrderValue, currency)} / ${percent(stall.cancellationRate)}`} /></dl></article>)}</div>
          {visibleStalls.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">此範圍沒有符合條件的攤位資料。</p> : null}
        </section>
      </> : null}

      {pendingBatchAction ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="batch-action-title" aria-describedby="batch-action-description" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-800"><TriangleAlert className="h-5 w-5" /></span><div><h2 id="batch-action-title" className="text-lg font-semibold">確認批次{pendingBatchAction === "PAUSE" ? "暫停" : "恢復"}？</h2><p className="mt-1 text-sm font-medium text-stone-800">將影響 {selectedStallIds.length} 個已選攤位</p></div></div>
            <p id="batch-action-description" className="mt-4 text-sm leading-6 text-stone-600">{pendingBatchAction === "PAUSE" ? "暫停後，這些攤位將停止接受新的 QR 點餐；既有訂單仍須完成處理。" : "恢復後，這些攤位將重新開放 QR 點餐。請先確認現場人力與商品供應。"}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" autoFocus disabled={batchRunning} onClick={() => setPendingBatchAction(null)} className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-50">返回檢查</button>
              <button type="button" disabled={batchRunning} onClick={() => void executeBatchAction()} className={`rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${pendingBatchAction === "PAUSE" ? "bg-amber-700" : "bg-emerald-700"}`}>{batchRunning ? "處理中..." : `確認${pendingBatchAction === "PAUSE" ? "暫停" : "恢復"}`}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex min-h-28 items-center gap-3 border-t border-stone-200 py-5 first:border-t-0 sm:px-4 lg:border-t-0 lg:border-r lg:last:border-r-0">{<span className="text-teal-700 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>}<div><div className="text-sm text-stone-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div></div>;
}

function MobileMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>;
}

function Status({ status }: { status: StallOption["businessStatus"] }) {
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${status === "OPEN" ? "bg-emerald-50 text-emerald-800" : status === "PAUSED" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-700"}`}>{statusLabels[status]}</span>;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function presetRange(preset: Exclude<DatePreset, "CUSTOM">, today: string) {
  const date = new Date(`${today}T00:00:00.000Z`);
  if (preset === "YESTERDAY") return { dateFrom: addDays(date, -1), dateTo: addDays(date, -1) };
  if (preset === "WEEK") {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    return { dateFrom: addDays(date, -mondayOffset), dateTo: today };
  }
  if (preset === "MONTH") return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
  return { dateFrom: today, dateTo: today };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
