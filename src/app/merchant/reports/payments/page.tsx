import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { prisma } from "@/lib/prisma";
import { getPaymentMethodReport } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";
import { getFeatureAccess } from "@/server/billing/feature-access";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppNumber } from "@/lib/locale-format";
import { createReportTranslator } from "@/lib/messages/reports";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function PaymentReportPage({ searchParams }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = createReportTranslator(locale);
  const scope = await requireReportScope(await searchParams);
  const featureAccess = await getFeatureAccess(scope.workspace.id, "PAYMENT_REPORT", {
    requireUsableSubscription: false,
  });
  if (!featureAccess.allowed) {
    return <FeatureUpgradeNotice title={t("reports.payments.title")} message={featureAccess.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} returnHref={`/merchant/reports/overview?organizationId=${scope.workspace.id}`} returnLabel={t("reports.nav.overview")} />;
  }
  const stallIds = scope.stalls.map((stall) => stall.id);
  const [rows, paymentRows] = await Promise.all([
    prisma.dailyStallSummary.findMany({ where: { organizationId: scope.workspace.id, stallId: { in: stallIds }, businessDate: { gte: new Date(`${scope.dateFrom}T00:00:00Z`), lte: new Date(`${scope.dateTo}T00:00:00Z`) } } }),
    getPaymentMethodReport(scope.workspace.id, stallIds, scope.dateFrom, scope.dateTo),
  ]);
  const total = aggregateDailyMetrics(rows);
  const methodTotals = new Map<string, { amount: number; count: number }>();
  for (const row of paymentRows) {
    const current = methodTotals.get(row.methodLabel) ?? { amount: 0, count: 0 };
    methodTotals.set(row.methodLabel, { amount: current.amount + row.amount, count: current.count + row.paymentCount });
  }
  return <main data-testid="report-payments" className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">{t("reports.eyebrow")}</p><h1 className="mt-1 text-3xl font-semibold">{t("reports.payments.title")}</h1><p className="mt-2 text-sm text-stone-600">{t("reports.payments.description")}</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="payments" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} multiStallMode={scope.workspace.operatingMode === "MULTI_STALL"} />
    <section className="border-b border-stone-200 py-5" aria-labelledby="payment-summary-title"><h2 id="payment-summary-title" className="sr-only">{t("reports.payments.summary")}</h2><dl data-testid="payment-summary-dashboard" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{[...methodTotals.entries()].map(([label, metric]) => <Metric key={label} label={`${label} · ${t("reports.count.orders", { count: formatAppNumber(locale, metric.count) })}`} value={formatAppCurrency(locale, metric.amount, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })} />)}<Metric label={t("reports.payments.unpaid")} value={formatAppNumber(locale, total.unpaidOrderCount)} /></dl></section>
    <section className="py-7"><h2 className="text-xl font-semibold">{t("reports.payments.byStall")}</h2><div data-testid="stall-payment-dashboard" className="mt-3 grid gap-3 sm:grid-cols-2">{scope.stalls.map((stall) => { const stallPayments = paymentRows.filter((row) => row.stallId === stall.id); return <article key={stall.id} className="min-w-0 overflow-hidden rounded-lg border border-stone-200"><h3 className="break-words border-b border-stone-200 px-3 py-3 font-semibold">{stall.name}</h3>{stallPayments.length > 0 ? <dl className="grid grid-cols-2 bg-white">{stallPayments.map((row) => <PaymentItem key={row.methodLabel} label={`${row.methodLabel} · ${t("reports.count.orders", { count: formatAppNumber(locale, row.paymentCount) })}`} value={formatAppCurrency(locale, row.amount, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })} />)}</dl> : <p className="px-3 py-6 text-sm text-stone-500">{t("reports.payments.none")}</p>}</article>; })}</div></section>
  </main>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-lg border border-stone-200 bg-white p-3 shadow-sm"><dt className="break-words text-xs text-stone-500 sm:text-sm">{label}</dt><dd className="mt-1 break-words text-lg font-semibold leading-tight tabular-nums text-stone-950 sm:text-xl">{value}</dd></div>; }
function PaymentItem({ label, value }: { label: string; value: string }) { return <div className="min-w-0 border-b border-r border-stone-200 bg-white p-3"><dt className="break-words text-xs text-stone-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold tabular-nums">{value}</dd></div>; }
