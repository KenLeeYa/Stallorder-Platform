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
    return <FeatureUpgradeNotice title="付款分析尚未開放" message={featureAccess.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} />;
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
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">跨攤位報表</p><h1 className="mt-1 text-3xl font-semibold">付款分析</h1><p className="mt-2 text-sm text-stone-600">依完成訂單時選取的付款方式統計，供每日對帳使用。</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="payments" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <section className="grid border-b border-stone-200 sm:grid-cols-2 lg:grid-cols-4">{[...methodTotals.entries()].map(([label, metric]) => <Metric key={label} label={`${label} · ${metric.count} 筆`} value={formatMoney(metric.amount, scope.workspace.defaultCurrency)} />)}<Metric label="未付款訂單" value={String(total.unpaidOrderCount)} /></section>
    <section className="py-7"><h2 className="text-xl font-semibold">各攤付款方式</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{scope.stalls.map((stall) => { const stallPayments = paymentRows.filter((row) => row.stallId === stall.id); return <div key={stall.id} className="py-4"><strong>{stall.name}</strong><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{stallPayments.map((row) => <div key={row.methodLabel} className="flex justify-between gap-3 text-sm"><span>{row.methodLabel} · {row.paymentCount} 筆</span><span className="font-semibold">{formatMoney(row.amount, scope.workspace.defaultCurrency)}</span></div>)}{stallPayments.length === 0 ? <span className="text-sm text-stone-500">此區間尚無已付款訂單。</span> : null}</div></div>; })}</div></section>
  </main>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="border-t border-stone-200 py-5 sm:px-4 lg:border-t-0"><div className="text-sm text-stone-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>; }
