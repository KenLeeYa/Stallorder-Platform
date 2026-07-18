"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, RefreshCw, ScrollText, ShieldAlert, TriangleAlert } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatTaipeiDateTime } from "@/lib/date-time";
import {
  OPERATIONS_PAGE_SIZES,
  type OperationsPageMeta,
  type OperationsPageSize,
} from "@/lib/operations-pagination";

type Alert = {
  id: string;
  stallName: string;
  alertType: string;
  severity: string;
  message: string;
  status: string;
  detectedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};
type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  requestId: string;
  stallName: string;
  actorName: string;
  actorEmail: string | null;
  metadata: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};
type FilterValues = {
  stallId?: string;
  alertStatus?: string;
  alertSeverity?: string;
  auditOutcome?: string;
  auditQuery?: string;
  dateFrom?: string;
  dateTo?: string;
};

const alertTypeLabels: Record<string, string> = {
  ORDERING_PAUSED: "點餐暫停",
  EXCESSIVE_PENDING_ORDERS: "待處理訂單過多",
  UNPAID_COMPLETED_ORDER: "完成但未付款",
  HIGH_CANCELLATION_RATE: "取消率偏高",
};

export function OperationsConsole({
  organizationId,
  stalls,
  alerts: initialAlerts,
  auditLogs,
  alertPagination,
  auditPagination,
  canManageAlerts,
  canViewAudit,
  filters,
}: {
  organizationId: string;
  stalls: Array<{ id: string; name: string }>;
  alerts: Alert[];
  auditLogs: AuditLog[];
  alertPagination: OperationsPageMeta;
  auditPagination: OperationsPageMeta;
  canManageAlerts: boolean;
  canViewAudit: boolean;
  filters: FilterValues;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [alertOverrides, setAlertOverrides] = useState<Record<string, Pick<Alert, "status" | "acknowledgedAt" | "resolvedAt">>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const alerts = initialAlerts.map((alert) => ({ ...alert, ...alertOverrides[alert.id] }));

  function navigatePagination(
    section: "alerts" | "auditLogs",
    page: number,
    pageSize: OperationsPageSize,
    replace = false,
  ) {
    const params = new URLSearchParams(searchParams.toString());
    const pageParam = section === "alerts" ? "alertPage" : "auditPage";
    const pageSizeParam = section === "alerts" ? "alertPageSize" : "auditPageSize";
    const hash = section === "alerts" ? "alerts-title" : "audit-title";
    params.set("organizationId", organizationId);
    params.set(pageParam, String(page));
    params.set(pageSizeParam, String(pageSize));
    const href = `${pathname}?${params.toString()}#${hash}`;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }

  async function updateAlert(alertId: string, status: "ACKNOWLEDGED" | "RESOLVED") {
    setUpdatingId(alertId);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/alerts/${alertId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "無法更新警示。");
      const currentAlert = alerts.find((alert) => alert.id === alertId);
      const updatedAt = new Date().toISOString();
      setAlertOverrides((current) => ({
        ...current,
        [alertId]: {
        status,
          acknowledgedAt: status === "ACKNOWLEDGED" ? updatedAt : currentAlert?.acknowledgedAt ?? null,
          resolvedAt: status === "RESOLVED" ? updatedAt : currentAlert?.resolvedAt ?? null,
        },
      }));
      setMessage(status === "ACKNOWLEDGED" ? "警示已確認並留下稽核紀錄。" : "警示已標記為已解除。");
      navigatePagination("alerts", 1, alertPagination.pageSize, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法更新警示。");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <div className="border-b border-stone-200 pb-5">
        <div className="flex items-center gap-2 text-teal-800"><ShieldAlert className="h-5 w-5" /><span className="text-sm font-semibold">治理與營運</span></div>
        <h1 className="mt-2 text-3xl font-semibold">稽核紀錄與營運警示</h1>
        <p className="mt-2 text-sm text-stone-600">依登入者權限、攤位與篩選條件，由伺服器分頁載入資料。</p>
      </div>

      <form method="get" className="grid gap-3 border-b border-stone-200 py-5 md:grid-cols-3 lg:grid-cols-6">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="alertPageSize" value={alertPagination.pageSize} />
        <input type="hidden" name="auditPageSize" value={auditPagination.pageSize} />
        <FilterSelect label="攤位" name="stallId" defaultValue={filters.stallId ?? ""}><option value="">全部授權攤位</option>{stalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}</FilterSelect>
        <FilterSelect label="警示狀態" name="alertStatus" defaultValue={filters.alertStatus ?? "ACTIVE"}><option value="ALL">全部</option><option value="ACTIVE">待處理</option><option value="ACKNOWLEDGED">已確認</option><option value="RESOLVED">已解除</option></FilterSelect>
        <FilterSelect label="嚴重程度" name="alertSeverity" defaultValue={filters.alertSeverity ?? "ALL"}><option value="ALL">全部</option><option value="CRITICAL">嚴重</option><option value="WARNING">警告</option><option value="INFO">資訊</option></FilterSelect>
        {canViewAudit ? (
          <>
            <FilterSelect label="稽核結果" name="auditOutcome" defaultValue={filters.auditOutcome ?? "ALL"}><option value="ALL">全部</option><option value="SUCCESS">成功</option><option value="DENIED">拒絕</option><option value="FAILURE">失敗</option></FilterSelect>
            <FilterInput label="開始日期" type="date" name="dateFrom" defaultValue={filters.dateFrom} />
            <FilterInput label="結束日期" type="date" name="dateTo" defaultValue={filters.dateTo} />
            <label className="text-xs font-semibold text-stone-600 md:col-span-2">搜尋稽核<input name="auditQuery" defaultValue={filters.auditQuery} maxLength={80} placeholder="操作、資料類型或 Request ID" className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 text-sm" /></label>
          </>
        ) : null}
        <div className="flex items-end gap-2"><button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white">套用篩選</button><button type="button" title="重新整理" onClick={() => router.refresh()} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><RefreshCw className="h-4 w-4" /></button></div>
      </form>

      {message ? <p role="status" className={`border-b border-stone-200 py-3 text-sm font-medium ${message.includes("無法") ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}

      <section className="border-b border-stone-200 py-6" aria-labelledby="alerts-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-amber-700" /><h2 id="alerts-title" className="text-lg font-semibold">營運警示</h2><span className="text-sm text-stone-500">共 {alertPagination.total} 筆</span></div>
          <PageSizeSelect label="營運警示" value={alertPagination.pageSize} onChange={(pageSize) => navigatePagination("alerts", 1, pageSize)} />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {alerts.map((alert) => (
            <article key={alert.id} className={`rounded-md border-l-4 bg-white p-4 ${alert.severity === "CRITICAL" ? "border-red-600" : "border-amber-500"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{alertTypeLabels[alert.alertType] ?? alert.alertType}</p><p className="mt-1 text-xs text-stone-500">{alert.stallName} · {formatTaipeiDateTime(alert.detectedAt)}</p></div><span className={`text-xs font-semibold ${alert.status === "ACTIVE" ? "text-red-700" : alert.status === "ACKNOWLEDGED" ? "text-amber-800" : "text-emerald-700"}`}>{alert.status === "ACTIVE" ? "待處理" : alert.status === "ACKNOWLEDGED" ? "已確認" : "已解除"}</span></div>
              <p className="mt-3 text-sm leading-6 text-stone-700">{alert.message}</p>
              {canManageAlerts && alert.status !== "RESOLVED" ? (
                <div className="mt-4 flex gap-2">
                  {alert.status === "ACTIVE" ? <button type="button" disabled={updatingId === alert.id} onClick={() => void updateAlert(alert.id, "ACKNOWLEDGED")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-300 px-3 text-sm font-semibold text-amber-900 disabled:opacity-50"><CircleAlert className="h-4 w-4" />確認警示</button> : null}
                  <button type="button" disabled={updatingId === alert.id} onClick={() => void updateAlert(alert.id, "RESOLVED")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />標記已解除</button>
                </div>
              ) : null}
            </article>
          ))}
          {alerts.length === 0 ? <p className="py-8 text-sm text-stone-500">目前篩選範圍沒有營運警示。</p> : null}
        </div>
        <PageNavigation label="營運警示" pagination={alertPagination} onPageChange={(page) => navigatePagination("alerts", page, alertPagination.pageSize)} />
      </section>

      {canViewAudit ? (
        <section className="py-6" aria-labelledby="audit-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><ScrollText className="h-5 w-5 text-teal-700" /><h2 id="audit-title" className="text-lg font-semibold">稽核紀錄</h2><span className="text-sm text-stone-500">共 {auditPagination.total} 筆</span></div>
            <PageSizeSelect label="稽核紀錄" value={auditPagination.pageSize} onChange={(pageSize) => navigatePagination("auditLogs", 1, pageSize)} />
          </div>
          <div className="mt-4 divide-y divide-stone-100 border-y border-stone-200">
            {auditLogs.map((log) => (
              <details key={log.id} className="group py-3">
                <summary className="grid cursor-pointer list-none gap-2 text-sm sm:grid-cols-[170px_minmax(180px,1fr)_130px_160px] sm:items-center [&::-webkit-details-marker]:hidden"><span className="text-xs text-stone-500">{formatTaipeiDateTime(log.createdAt)}</span><span className="min-w-0 truncate font-semibold">{log.action}</span><span className={log.outcome === "SUCCESS" ? "text-emerald-700" : "text-red-700"}>{log.outcome === "SUCCESS" ? "成功" : log.outcome === "DENIED" ? "拒絕" : "失敗"}</span><span className="truncate text-xs text-stone-500">{log.actorName} · {log.stallName}</span></summary>
                <div className="mt-3 grid gap-3 bg-stone-50 p-3 text-xs text-stone-700 md:grid-cols-2"><dl className="grid grid-cols-[100px_1fr] gap-2"><dt className="text-stone-500">資料類型</dt><dd>{log.entityType}</dd><dt className="text-stone-500">資料 ID</dt><dd className="break-all">{log.entityId ?? "-"}</dd><dt className="text-stone-500">Request ID</dt><dd className="break-all">{log.requestId}</dd><dt className="text-stone-500">操作員</dt><dd className="break-all">{log.actorEmail ?? log.actorName}</dd></dl><div><p className="text-stone-500">變更內容</p><pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{formatAuditPayload(log)}</pre></div></div>
              </details>
            ))}
            {auditLogs.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">目前篩選範圍沒有稽核紀錄。</p> : null}
          </div>
          <PageNavigation label="稽核紀錄" pagination={auditPagination} onPageChange={(page) => navigatePagination("auditLogs", page, auditPagination.pageSize)} />
        </section>
      ) : null}
    </main>
  );
}

function PageSizeSelect({ label, value, onChange }: { label: string; value: OperationsPageSize; onChange: (value: OperationsPageSize) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-600">
      每頁
      <select aria-label={`${label}每頁顯示數量`} value={value} onChange={(event) => onChange(Number(event.target.value) as OperationsPageSize)} className="h-9 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900">
        {OPERATIONS_PAGE_SIZES.map((pageSize) => <option key={pageSize} value={pageSize}>{pageSize}</option>)}
      </select>
      筆
    </label>
  );
}

function PageNavigation({ label, pagination, onPageChange }: { label: string; pagination: OperationsPageMeta; onPageChange: (page: number) => void }) {
  return (
    <nav aria-label={`${label}分頁`} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
      <span>{pagination.total === 0 ? "沒有資料" : `顯示 ${pagination.firstItem}–${pagination.lastItem}，共 ${pagination.total} 筆`}</span>
      <div className="flex items-center gap-2">
        <button type="button" title={`${label}上一頁`} aria-label={`${label}上一頁`} disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-20 text-center text-xs font-semibold text-stone-700">第 {pagination.page} / {pagination.totalPages} 頁</span>
        <button type="button" title={`${label}下一頁`} aria-label={`${label}下一頁`} disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  );
}

function FilterSelect({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<select {...props} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-2 text-sm">{children}</select></label>;
}

function FilterInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<input {...props} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm" /></label>;
}

function formatAuditPayload(log: AuditLog) {
  const metadata = parseMetadata(log.metadata);
  if (!metadata && !log.before && !log.after) return "無額外內容";
  return JSON.stringify({ metadata, before: log.before, after: log.after }, null, 2);
}

function parseMetadata(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}
