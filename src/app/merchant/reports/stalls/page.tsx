import Link from "next/link";
import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppNumber } from "@/lib/locale-format";
import { createReportTranslator } from "@/lib/messages/reports";
import { prisma } from "@/lib/prisma";
import { requireReportScope } from "@/lib/report-scope";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function StallComparisonPage({ searchParams }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = createReportTranslator(locale);
  const scope = await requireReportScope(await searchParams);
  const featureCode = scope.stalls.length > 1 ? "MULTI_STALL_DASHBOARD" : "BASIC_REPORTS";
  const featureAccess = await getFeatureAccess(scope.workspace.id, featureCode, {
    requireUsableSubscription: false,
  });
  if (!featureAccess.allowed) {
    return <FeatureUpgradeNotice title={t("reports.stalls.title")} message={featureAccess.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} returnHref={`/merchant/reports/overview?organizationId=${scope.workspace.id}`} returnLabel={t("reports.nav.overview")} />;
  }
  const rows = await prisma.dailyStallSummary.findMany({ where: { organizationId: scope.workspace.id, stallId: { in: scope.stalls.map((stall) => stall.id) }, businessDate: { gte: new Date(`${scope.dateFrom}T00:00:00Z`), lte: new Date(`${scope.dateTo}T00:00:00Z`) } } });
  const metrics = scope.stalls.map((stall) => ({ stall, metric: aggregateDailyMetrics(rows.filter((row) => row.stallId === stall.id)) })).sort((a, b) => b.metric.totalSales - a.metric.totalSales);
  return <main data-testid="report-stalls" className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">{t("reports.eyebrow")}</p><h1 className="mt-1 text-3xl font-semibold">{t("reports.stalls.title")}</h1><p className="mt-2 text-sm text-stone-600">{t("reports.stalls.description")}</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="stalls" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} multiStallMode={scope.workspace.operatingMode === "MULTI_STALL"} />
    <div data-testid="stall-performance-dashboard" className="mt-6 grid gap-5 xl:grid-cols-2">{metrics.map(({ stall, metric }) => <article key={stall.id} data-testid="stall-performance-card" className="min-w-0"><div className="mb-2 px-1"><Link href={`/merchant/stalls/${stall.id}/dashboard`} className="break-words font-semibold text-teal-800">{stall.name}</Link></div><dl className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3 sm:grid-cols-4"><Item label={t("reports.orderEntryAmount")} value={formatAppCurrency(locale, metric.totalSales, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })} /><Item label={t("reports.orderCount")} value={formatAppNumber(locale, metric.orderCount)} /><Item label={t("reports.stalls.completed")} value={formatAppNumber(locale, metric.completedOrderCount)} /><Item label={t("reports.averageOrder")} value={formatAppCurrency(locale, metric.averageOrderValue, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })} /><Item label={t("reports.stalls.pending")} value={formatAppNumber(locale, metric.pendingOrderCount)} /><Item label={t("reports.stalls.unpaid")} value={formatAppNumber(locale, metric.unpaidOrderCount)} /><Item wide label={t("reports.cancellationRate")} value={formatAppNumber(locale, metric.cancellationRate, { style: "percent", maximumFractionDigits: 1 })} /></dl></article>)}</div>
  </main>;
}
function Item({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) { return <div className={`min-w-0 rounded-lg border border-stone-200 bg-white p-3 shadow-sm ${wide ? "col-span-2 min-[360px]:col-span-3 sm:col-span-2" : ""}`}><dt className="text-xs text-stone-500 sm:text-sm">{label}</dt><dd className="mt-1 break-words text-lg font-semibold leading-tight tabular-nums text-stone-950 sm:text-xl">{value}</dd></div>; }
