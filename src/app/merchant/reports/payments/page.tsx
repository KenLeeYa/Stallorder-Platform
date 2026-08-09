import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getPaymentMethodReport } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function PaymentReportPage({ searchParams }: PageProps) {
  const scope = await requireReportScope(await searchParams);
  const featureAccess = await getFeatureAccess(scope.workspace.id, "PAYMENT_REPORT", {
    requireUsableSubscription: false,
  });
  if (!featureAccess.allowed) {
    return <FeatureUpgradeNotice title="付款分析尚未開放" message={featureAccess.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} returnHref={`/merchant/reports/overview?organizationId=${scope.workspace.id}`} returnLabel="返回銷售趨勢總覽" />;
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
    <div><p className="text-sm font-semibold text-teal-800">跨攤位報表</p><h1 className="mt-1 text-3xl font-semibold">付款分析</h1><p className="mt-2 text-sm text-stone-600">依完成訂單時選取的付款方式統計，供每日對帳使用。</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="payments" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <section className="border-b border-stone-200 py-5" aria-labelledby="payment-summary-title"><h2 id="payment-summary-title" className="sr-only">付款摘要</h2><dl data-testid="payment-summary-dashboard" className="grid grid-cols-2 overflow-hidden rounded-lg border border-stone-200 bg-white sm:grid-cols-3 lg:grid-cols-4">{[...methodTotals.entries()].map(([label, metric]) => <Metric key={label} label={`${label} · ${metric.count} 筆`} value={formatMoney(metric.amount, scope.workspace.defaultCurrency)} />)}<Metric label="未付款訂單" value={String(total.unpaidOrderCount)} /></dl></section>
    <section className="py-7"><h2 className="text-xl font-semibold">各攤付款方式</h2><div data-testid="stall-payment-dashboard" className="mt-3 grid gap-3 sm:grid-cols-2">{scope.stalls.map((stall) => { const stallPayments = paymentRows.filter((row) => row.stallId === stall.id); return <article key={stall.id} className="min-w-0 overflow-hidden rounded-lg border border-stone-200"><h3 className="break-words border-b border-stone-200 px-3 py-3 font-semibold">{stall.name}</h3>{stallPayments.length > 0 ? <dl className="grid grid-cols-2 bg-white">{stallPayments.map((row) => <PaymentItem key={row.methodLabel} label={`${row.methodLabel} · ${row.paymentCount} 筆`} value={formatMoney(row.amount, scope.workspace.defaultCurrency)} />)}</dl> : <p className="px-3 py-6 text-sm text-stone-500">此區間尚無已付款訂單。</p>}</article>; })}</div></section>
  </main>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 border-b border-r border-stone-200 bg-white p-3 only:col-span-full sm:px-4 sm:py-5"><dt className="break-words text-xs text-stone-500 sm:text-sm">{label}</dt><dd className="mt-1 break-words text-lg font-semibold leading-tight tabular-nums sm:text-2xl">{value}</dd></div>; }
function PaymentItem({ label, value }: { label: string; value: string }) { return <div className="min-w-0 border-b border-r border-stone-200 bg-white p-3"><dt className="break-words text-xs text-stone-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold tabular-nums">{value}</dd></div>; }
