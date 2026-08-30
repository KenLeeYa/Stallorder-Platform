import type { FulfillmentType, OrderStatus } from "@prisma/client";
import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { ReportPageNavigation, ReportPageSizeSelect } from "@/components/report-pagination-controls";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDateTime, formatAppNumber } from "@/lib/locale-format";
import { createReportTranslator, type ReportMessageKey } from "@/lib/messages/reports";
import { parseOperationsPage, parseOperationsPageSize } from "@/lib/operations-pagination";
import { getPaginatedOrderHistoryReport } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string; page?: string; pageSize?: string }> };

export default async function OrderHistoryReportPage({ searchParams }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = createReportTranslator(locale);
  const query = await searchParams;
  const scope = await requireReportScope(query);
  const { rows: orders, pagination } = await getPaginatedOrderHistoryReport(
    scope.workspace.id,
    scope.stalls.map((stall) => stall.id),
    scope.dateFrom,
    scope.dateTo,
    { page: parseOperationsPage(query.page), pageSize: parseOperationsPageSize(query.pageSize) },
  );

  return <main data-testid="report-orders" className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">{t("reports.eyebrow")}</p><h1 className="mt-1 text-3xl font-semibold">{t("reports.orders.title")}</h1><p className="mt-2 text-sm text-stone-600">{t("reports.orders.description")}</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="orders" />
    <ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} multiStallMode={scope.workspace.operatingMode === "MULTI_STALL"} pageSize={pagination.pageSize} />
    <section id="orders-list" className="py-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold text-stone-700">{t("reports.count.orders", { count: formatAppNumber(locale, pagination.total) })}</p><ReportPageSizeSelect label={t("reports.orders.title")} pagination={pagination} anchorId="orders-list" /></div>
      <div className="divide-y divide-stone-200 border-y border-stone-200">
        {orders.map((order) => <details key={order.id} className="group py-4">
          <summary className="grid cursor-pointer list-none gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <span className="min-w-0"><strong className="break-words">#{order.orderNo} · {order.stall.name}</strong><span className="mt-1 block text-xs text-stone-600">{formatAppDateTime(locale, order.createdAt)} · {fulfillmentLabel(order.fulfillmentType, t)} · {statusLabel(order.status, t)}</span></span>
            <span className="font-semibold tabular-nums">{formatAppCurrency(locale, order.total, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</span>
          </summary>
          <div className="mt-4 rounded-lg bg-stone-50 p-4 text-sm">
            <p className="font-medium">{order.customerName || t("reports.orders.walkIn")}{order.customerPhone ? ` · ${order.customerPhone}` : ""}{order.tableLabel ? ` · ${order.tableLabel}` : ""}</p>
            <ul className="mt-3 divide-y divide-stone-200">{order.items.map((item) => <li key={item.id} className="flex items-start justify-between gap-3 py-2"><span><strong>{formatAppNumber(locale, item.quantity)} × {item.name}</strong>{item.note ? <span className="mt-0.5 block text-xs text-stone-600">{item.note}</span> : null}</span><span className="shrink-0 tabular-nums">{formatAppCurrency(locale, item.unitPrice * item.quantity, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</span></li>)}</ul>
            <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-stone-200 pt-3"><span>{t("reports.orders.payment")}：{order.payment?.methodLabel ?? t("reports.orders.unpaid")}</span><strong>{formatAppCurrency(locale, order.total, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</strong></div>
            {order.note ? <p className="mt-2 text-xs text-stone-600">{t("reports.orders.note")}：{order.note}</p> : null}
          </div>
        </details>)}
        {orders.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{t("reports.orders.none")}</p> : null}
      </div>
      <ReportPageNavigation label={t("reports.orders.title")} pagination={pagination} anchorId="orders-list" />
    </section>
  </main>;
}

function statusLabel(status: OrderStatus, t: (key: ReportMessageKey) => string) {
  const keys: Record<OrderStatus, ReportMessageKey> = {
    WAITING_CONFIRMATION: "reports.orders.status.waiting",
    CONFIRMED: "reports.orders.status.confirmed",
    PREPARING: "reports.orders.status.preparing",
    PACKING: "reports.orders.status.packing",
    READY: "reports.orders.status.ready",
    COMPLETED: "reports.orders.status.completed",
    CANCELLED: "reports.orders.status.cancelled",
    EXPIRED: "reports.orders.status.expired",
  };
  return t(keys[status]);
}

function fulfillmentLabel(type: FulfillmentType, t: (key: ReportMessageKey) => string) {
  if (type === "TAKEOUT") return t("reports.orders.fulfillment.takeout");
  if (type === "DINE_IN") return t("reports.orders.fulfillment.dineIn");
  return t("reports.orders.fulfillment.delivery");
}
