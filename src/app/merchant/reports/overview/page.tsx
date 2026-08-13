import { Suspense } from "react";
import { RouteLoadingSkeleton } from "@/components/route-loading-skeleton";
import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { cancellationReasonLabels } from "@/lib/cancellation-reasons";
import { prisma } from "@/lib/prisma";
import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { getCancellationReasonReport, getHourlySalesReport } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { createReportTranslator } from "@/lib/messages/reports";
import { getFeatureAccess } from "@/server/billing/feature-access";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { createRequestId } from "@/lib/security";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function ReportOverviewPage({ searchParams }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = createReportTranslator(locale);
  const timing = createPerformanceTiming({
    route: "/merchant/reports/overview",
    requestId: createRequestId(),
  });
  const query = await searchParams;
  const scope = await timing.measure(
    "authMs",
    () => timing.measureDb(() => requireReportScope(query), 4),
  );
  const featureAccess = await timing.measureDb(() => getFeatureAccess(
    scope.workspace.id,
    "BASIC_REPORTS",
    { requireUsableSubscription: false },
  ));
  if (!featureAccess.allowed) {
    timing.finish({ status: 200 });
    return <FeatureUpgradeNotice message={featureAccess.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} returnHref={`/merchant/dashboard?organizationId=${scope.workspace.id}`} returnLabel={t("reports.nav.overview")} />;
  }
  return (
    <Suspense fallback={<RouteLoadingSkeleton variant="reports" />}>
      <ReportOverviewContent scope={scope} timing={timing} locale={locale} />
    </Suspense>
  );
}

async function ReportOverviewContent({
  scope,
  timing,
  locale,
}: {
  scope: Awaited<ReturnType<typeof requireReportScope>>;
  timing: ReturnType<typeof createPerformanceTiming>;
  locale: Awaited<ReturnType<typeof getRequestAppLocale>>["locale"];
}) {
  const t = createReportTranslator(locale);
  const stallIds = scope.stalls.map((stall) => stall.id);
  const [rows, hourRows, cancellationRows] = await timing.measureDb(() => Promise.all([
    prisma.dailyStallSummary.findMany({
      where: {
        organizationId: scope.workspace.id,
        stallId: { in: stallIds },
        businessDate: { gte: new Date(`${scope.dateFrom}T00:00:00Z`), lte: new Date(`${scope.dateTo}T00:00:00Z`) },
      },
      orderBy: { businessDate: "asc" },
    }),
    getHourlySalesReport(scope.workspace.id, stallIds, scope.dateFrom, scope.dateTo),
    getCancellationReasonReport(scope.workspace.id, stallIds, scope.dateFrom, scope.dateTo),
  ]), 3);
  timing.finish({ status: 200 });
  const total = aggregateDailyMetrics(rows);
  const daily = [...new Set(rows.map((row) => row.businessDate.toISOString().slice(0, 10)))].map((businessDate) => ({
    businessDate,
    ...aggregateDailyMetrics(rows.filter((row) => row.businessDate.toISOString().slice(0, 10) === businessDate)),
  }));
  const weeks = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = weekStart(row.businessDate);
    weeks.set(key, [...(weeks.get(key) ?? []), row]);
  }
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const matching = hourRows.filter((row) => row.hour === hour);
    return {
      hour,
      orderCount: matching.reduce((sum, row) => sum + row.orderCount, 0),
      sales: matching.reduce((sum, row) => sum + row.sales, 0),
    };
  });

  return <main data-testid="report-overview" className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-4 sm:py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">{t("reports.eyebrow")}</p><h1 className="mt-1 text-3xl font-semibold">{t("reports.overview.title")}</h1><p className="mt-2 hidden text-sm text-stone-600 sm:block">{scope.workspace.businessName} · {formatAppDate(locale, `${scope.dateFrom}T00:00:00Z`)} {t("reports.filter.to")} {formatAppDate(locale, `${scope.dateTo}T00:00:00Z`)}</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="overview" />
    <ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <section className="border-b border-stone-200 py-3 sm:py-5" aria-labelledby="sales-summary-title">
      <h2 id="sales-summary-title" className="sr-only">{t("reports.overview.summary")}</h2>
      <dl data-testid="sales-summary-dashboard" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 sm:grid-cols-4">
        <Metric label={t("reports.orderEntryAmount")} value={formatAppCurrency(locale, total.totalSales, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })} />
        <Metric label={t("reports.orderCount")} value={formatAppNumber(locale, total.orderCount)} />
        <Metric label={t("reports.averageOrder")} value={formatAppCurrency(locale, total.averageOrderValue, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })} />
        <Metric label={t("reports.cancellationRate")} value={formatAppNumber(locale, total.cancellationRate, { style: "percent", maximumFractionDigits: 1 })} />
      </dl>
    </section>
    <section className="border-b border-stone-200 py-4 sm:py-7" aria-labelledby="hourly-sales-title">
      <h2 id="hourly-sales-title" className="text-xl font-semibold">{t("reports.hourlySales")}</h2>
      <ul data-testid="hourly-sales-dashboard" className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 min-[380px]:grid-cols-6 md:grid-cols-8">
        {hourly.map((row) => (
          <li key={row.hour} data-testid="hourly-sales-cell" className="min-w-0 bg-white px-1.5 py-2 sm:px-2 sm:py-3">
            <div className="text-[11px] font-semibold tabular-nums text-stone-500 sm:text-xs">{String(row.hour).padStart(2, "0")}:00</div>
            <div data-testid="hourly-sales-value" className="mt-1 break-words text-xs font-semibold leading-tight tabular-nums sm:text-sm">{formatAppCurrency(locale, row.sales, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</div>
            <div className="mt-1 text-[11px] tabular-nums text-stone-500 sm:text-xs">{t("reports.count.orders", { count: formatAppNumber(locale, row.orderCount) })}</div>
          </li>
        ))}
      </ul>
    </section>
    <section className="border-b border-stone-200 py-4 sm:py-7"><h2 className="text-xl font-semibold">{t("reports.cancellationAnalysis")}</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{cancellationRows.map((row) => <div key={`${row.stallId}-${row.reason}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 py-3 text-sm"><span className="truncate">{row.stallName}</span><span>{cancellationReasonLabels[row.reason]}</span><strong>{t("reports.count.orders", { count: formatAppNumber(locale, row.count) })}</strong></div>)}{cancellationRows.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">{t("reports.noCancellations")}</p> : null}</div></section>
    <section className="grid gap-5 py-4 sm:gap-8 sm:py-7 lg:grid-cols-2">
      <div><h2 className="text-xl font-semibold">{t("reports.dailyTrend")}</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{daily.map((row) => <div key={row.businessDate} className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm"><span>{formatAppDate(locale, `${row.businessDate}T00:00:00Z`)}</span><span>{t("reports.count.orders", { count: formatAppNumber(locale, row.orderCount) })}</span><strong>{formatAppCurrency(locale, row.totalSales, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</strong></div>)}{daily.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">{t("reports.noOrderData")}</p> : null}</div></div>
      <div><h2 className="text-xl font-semibold">{t("reports.weeklyTrend")}</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{[...weeks.entries()].map(([week, weekRows]) => { const metric = aggregateDailyMetrics(weekRows); return <div key={week} className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm"><span>{t("reports.weekStart", { date: formatAppDate(locale, `${week}T00:00:00Z`) })}</span><span>{t("reports.count.orders", { count: formatAppNumber(locale, metric.orderCount) })}</span><strong>{formatAppCurrency(locale, metric.totalSales, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</strong></div>; })}{weeks.size === 0 ? <p className="py-8 text-center text-sm text-stone-500">{t("reports.noOrderData")}</p> : null}</div></div>
    </section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-white p-3 sm:px-4 sm:py-5"><dt className="text-xs text-stone-500 sm:text-sm">{label}</dt><dd className="mt-1 break-words text-lg font-semibold leading-tight tabular-nums sm:text-2xl">{value}</dd></div>;
}
function weekStart(date: Date) { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7)); return copy.toISOString().slice(0, 10); }
