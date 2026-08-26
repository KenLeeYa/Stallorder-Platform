"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleAlert, RefreshCw, ScrollText, ShieldAlert, TriangleAlert } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { auditActionLabel, auditEntityTypeLabel } from "@/lib/audit-log-labels";
import { formatAppDateTime, formatAppNumber } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import type { MerchantMessageKey } from "@/lib/messages/merchant";
import {
  MerchantListPageNavigation as PageNavigation,
  MerchantListPageSizeSelect as PageSizeSelect,
} from "@/components/merchant-list-pagination";
import {
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

const alertTypeLabels = {
  ORDERING_PAUSED: "點餐暫停",
  EXCESSIVE_PENDING_ORDERS: "待處理訂單過多",
  UNPAID_COMPLETED_ORDER: "完成但未付款",
  HIGH_CANCELLATION_RATE: "取消率偏高",
} as const satisfies Record<string, MerchantMessageKey>;

const alertTypeDescriptions = {
  ORDERING_PAUSED: "攤位目前暫停接受新訂單。",
  EXCESSIVE_PENDING_ORDERS: "待處理訂單數量超過警示門檻。",
  UNPAID_COMPLETED_ORDER: "已有完成但尚未付款的訂單。",
  HIGH_CANCELLATION_RATE: "近期訂單取消率超過警示門檻。",
} as const satisfies Record<string, MerchantMessageKey>;

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
  const { locale, m } = useMerchantMessages();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [alertOverrides, setAlertOverrides] = useState<Record<string, Pick<Alert, "status" | "acknowledgedAt" | "resolvedAt">>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
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
    setHasError(false);
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/alerts/${alertId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          locale === "zh-TW" && typeof payload.error === "string"
            ? payload.error
            : m("無法更新警示。"),
        );
      }
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
      setMessage(status === "ACKNOWLEDGED" ? m("警示已確認並留下稽核紀錄。") : m("警示已標記為已解除。"));
      navigatePagination("alerts", 1, alertPagination.pageSize, true);
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : m("無法更新警示。"));
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <div className="border-b border-stone-200 pb-5">
        <div className="flex items-center gap-2 text-teal-800"><ShieldAlert className="h-5 w-5" /><span className="text-sm font-semibold">{m("治理與營運")}</span></div>
        <h1 className="mt-2 text-3xl font-semibold">{m("稽核紀錄與營運警示")}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("依登入者權限、攤位與篩選條件，由伺服器分頁載入資料。")}</p>
      </div>

      <form method="get" className="border-b border-stone-200 py-5">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="alertPageSize" value={alertPagination.pageSize} />
        <input type="hidden" name="auditPageSize" value={auditPagination.pageSize} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FilterSelect label={m("攤位")} name="stallId" defaultValue={filters.stallId ?? ""}><option value="">{m("全部授權攤位")}</option>{stalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}</FilterSelect>
          <FilterSelect label={m("警示狀態")} name="alertStatus" defaultValue={filters.alertStatus ?? "ACTIVE"}><option value="ALL">{m("全部")}</option><option value="ACTIVE">{m("待處理")}</option><option value="ACKNOWLEDGED">{m("已確認")}</option><option value="RESOLVED">{m("已解除")}</option></FilterSelect>
          <FilterSelect label={m("嚴重程度")} name="alertSeverity" defaultValue={filters.alertSeverity ?? "ALL"}><option value="ALL">{m("全部")}</option><option value="CRITICAL">{m("嚴重")}</option><option value="WARNING">{m("警告")}</option><option value="INFO">{m("資訊")}</option></FilterSelect>
          {canViewAudit ? (
            <>
              <FilterSelect label={m("稽核結果")} name="auditOutcome" defaultValue={filters.auditOutcome ?? "ALL"}><option value="ALL">{m("全部")}</option><option value="SUCCESS">{m("成功")}</option><option value="DENIED">{m("拒絕")}</option><option value="FAILURE">{m("失敗")}</option></FilterSelect>
              <FilterInput label={m("開始日期")} type="date" name="dateFrom" defaultValue={filters.dateFrom} />
              <FilterInput label={m("結束日期")} type="date" name="dateTo" defaultValue={filters.dateTo} />
              <label className="col-span-2 text-xs font-semibold text-stone-600">{m("搜尋稽核")}<input type="text" name="auditQuery" defaultValue={filters.auditQuery} maxLength={80} placeholder={m("操作、資料類型或 Request ID")} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 text-sm" /></label>
            </>
          ) : null}
        </div>
        <div className="mt-3 flex justify-end gap-2"><button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white">{m("套用篩選")}</button><button type="button" title={m("重新整理")} aria-label={m("重新整理")} onClick={() => router.refresh()} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"><RefreshCw className="h-4 w-4" /></button></div>
      </form>

      {message ? <p role="status" className={`border-b border-stone-200 py-3 text-sm font-medium ${hasError ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}

      <section className="border-b border-stone-200 py-6" aria-labelledby="alerts-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-amber-700" /><h2 id="alerts-title" className="text-lg font-semibold">{m("營運警示")}</h2><span className="text-sm text-stone-500">{m("共 {count} 筆", { count: formatAppNumber(locale, alertPagination.total) })}</span></div>
          <PageSizeSelect label={m("營運警示")} value={alertPagination.pageSize} onChange={(pageSize) => navigatePagination("alerts", 1, pageSize)} />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {alerts.map((alert) => (
            <article key={alert.id} className={`rounded-md border-l-4 bg-white p-4 ${alert.severity === "CRITICAL" ? "border-red-600" : "border-amber-500"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{localizeAlertType(alert.alertType, m)}</p><p className="mt-1 text-xs text-stone-500">{alert.stallName} · {formatAppDateTime(locale, alert.detectedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</p></div><span className={`text-xs font-semibold ${alert.status === "ACTIVE" ? "text-red-700" : alert.status === "ACKNOWLEDGED" ? "text-amber-800" : "text-emerald-700"}`}>{alert.status === "ACTIVE" ? m("待處理") : alert.status === "ACKNOWLEDGED" ? m("已確認") : m("已解除")}</span></div>
              <p className="mt-3 text-sm leading-6 text-stone-700">{localizeAlertDescription(alert, locale, m)}</p>
              {canManageAlerts && alert.status !== "RESOLVED" ? (
                <div className="mt-4 flex gap-2">
                  {alert.status === "ACTIVE" ? <button type="button" disabled={updatingId === alert.id} onClick={() => void updateAlert(alert.id, "ACKNOWLEDGED")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-300 px-3 text-sm font-semibold text-amber-900 disabled:opacity-50"><CircleAlert className="h-4 w-4" />{m("確認警示")}</button> : null}
                  <button type="button" disabled={updatingId === alert.id} onClick={() => void updateAlert(alert.id, "RESOLVED")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{m("標記已解除")}</button>
                </div>
              ) : null}
            </article>
          ))}
          {alerts.length === 0 ? <p className="py-8 text-sm text-stone-500">{m("目前篩選範圍沒有營運警示。")}</p> : null}
        </div>
        <PageNavigation label={m("營運警示")} pagination={alertPagination} onPageChange={(page) => navigatePagination("alerts", page, alertPagination.pageSize)} />
      </section>

      {canViewAudit ? (
        <section className="py-6" aria-labelledby="audit-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><ScrollText className="h-5 w-5 text-teal-700" /><h2 id="audit-title" className="text-lg font-semibold">{m("稽核紀錄")}</h2><span className="text-sm text-stone-500">{m("共 {count} 筆", { count: formatAppNumber(locale, auditPagination.total) })}</span></div>
            <PageSizeSelect label={m("稽核紀錄")} value={auditPagination.pageSize} onChange={(pageSize) => navigatePagination("auditLogs", 1, pageSize)} />
          </div>
          <div className="mt-4 divide-y divide-stone-100 border-y border-stone-200">
            {auditLogs.map((log) => (
              <details key={log.id} className="group py-3">
                <summary className="grid cursor-pointer list-none gap-2 text-sm sm:grid-cols-[170px_minmax(180px,1fr)_130px_160px] sm:items-center [&::-webkit-details-marker]:hidden"><span className="text-xs text-stone-500">{formatAppDateTime(locale, log.createdAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</span><span className="min-w-0 truncate font-semibold">{locale === "zh-TW" ? auditActionLabel(log.action) : readableCode(log.action)}</span><span className={log.outcome === "SUCCESS" ? "text-emerald-700" : "text-red-700"}>{log.outcome === "SUCCESS" ? m("成功") : log.outcome === "DENIED" ? m("拒絕") : m("失敗")}</span><span className="truncate text-xs text-stone-500">{log.actorName} · {log.stallName}</span></summary>
                <div className="mt-3 grid gap-3 bg-stone-50 p-3 text-xs text-stone-700 md:grid-cols-2"><dl className="grid grid-cols-[112px_1fr] gap-2"><dt className="text-stone-500">{m("資料類型")}</dt><dd>{locale === "zh-TW" ? auditEntityTypeLabel(log.entityType) : readableCode(log.entityType)}</dd><dt className="text-stone-500">{m("目標資料 ID")}</dt><dd className="break-all">{log.entityId ?? "-"}</dd><dt className="text-stone-500">{m("操作追蹤碼")}</dt><dd className="break-all">{log.requestId}</dd><dt className="text-stone-500">{m("操作員")}</dt><dd className="break-all">{log.actorEmail ?? log.actorName}</dd><dt className="text-stone-500">{m("原始動作代碼")}</dt><dd className="break-all font-mono text-[11px]">{log.action}</dd><dt className="text-stone-500">{m("原始類型代碼")}</dt><dd className="break-all font-mono text-[11px]">{log.entityType}</dd></dl><div><p className="text-stone-500">{m("原始變更資料")}</p><pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{formatAuditPayload(log, m("無額外內容"))}</pre></div></div>
              </details>
            ))}
            {auditLogs.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">{m("目前篩選範圍沒有稽核紀錄。")}</p> : null}
          </div>
          <PageNavigation label={m("稽核紀錄")} pagination={auditPagination} onPageChange={(page) => navigatePagination("auditLogs", page, auditPagination.pageSize)} />
        </section>
      ) : null}
    </main>
  );
}

function FilterSelect({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<select {...props} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-2 text-sm">{children}</select></label>;
}

function FilterInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<input type="text" maxLength={80} {...props} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-2 text-sm" /></label>;
}

function formatAuditPayload(log: AuditLog, emptyLabel: string) {
  const metadata = parseMetadata(log.metadata);
  if (!metadata && !log.before && !log.after) return emptyLabel;
  return JSON.stringify({ metadata, before: log.before, after: log.after }, null, 2);
}

function localizeAlertType(
  alertType: string,
  m: (key: MerchantMessageKey) => string,
) {
  const key = alertTypeLabels[alertType as keyof typeof alertTypeLabels];
  return key ? m(key) : readableCode(alertType);
}

function localizeAlertDescription(
  alert: Alert,
  locale: string,
  m: (key: MerchantMessageKey) => string,
) {
  if (locale === "zh-TW") return alert.message;
  const key = alertTypeDescriptions[alert.alertType as keyof typeof alertTypeDescriptions];
  return key ? m(key) : readableCode(alert.alertType);
}

function readableCode(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function parseMetadata(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}
