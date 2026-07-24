import Link from "next/link";
import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireReportScope } from "@/lib/report-scope";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function StallComparisonPage({ searchParams }: PageProps) {
  const scope = await requireReportScope(await searchParams);
  const featureCode = scope.stalls.length > 1 ? "MULTI_STALL_DASHBOARD" : "BASIC_REPORTS";
  const featureAccess = await getFeatureAccess(scope.workspace.id, featureCode, {
    requireUsableSubscription: false,
  });
  if (!featureAccess.allowed) {
    return <FeatureUpgradeNotice title="攤位比較尚未開放" message={featureAccess.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} returnHref={`/merchant/reports/overview?organizationId=${scope.workspace.id}`} returnLabel="返回銷售趨勢總覽" />;
  }
  const rows = await prisma.dailyStallSummary.findMany({ where: { organizationId: scope.workspace.id, stallId: { in: scope.stalls.map((stall) => stall.id) }, businessDate: { gte: new Date(`${scope.dateFrom}T00:00:00Z`), lte: new Date(`${scope.dateTo}T00:00:00Z`) } } });
  const metrics = scope.stalls.map((stall) => ({ stall, metric: aggregateDailyMetrics(rows.filter((row) => row.stallId === stall.id)) })).sort((a, b) => b.metric.totalSales - a.metric.totalSales);
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">跨攤位報表</p><h1 className="mt-1 text-3xl font-semibold">攤位績效比較</h1><p className="mt-2 text-sm text-stone-600">銷售、訂單、未付款與取消率比較。</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="stalls" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <div className="mt-6 hidden md:block"><table className="w-full border-y border-stone-200 text-left text-sm"><thead className="text-stone-500"><tr><th className="py-3">攤位</th><th>銷售額</th><th>訂單</th><th>完成</th><th>平均客單</th><th>待處理</th><th>未付款</th><th>取消率</th></tr></thead><tbody>{metrics.map(({ stall, metric }) => <tr key={stall.id} className="border-t border-stone-100"><td className="py-4"><Link href={`/merchant/stalls/${stall.id}/dashboard`} className="font-semibold text-teal-800">{stall.name}</Link></td><td>{formatMoney(metric.totalSales, scope.workspace.defaultCurrency)}</td><td>{metric.orderCount}</td><td>{metric.completedOrderCount}</td><td>{formatMoney(metric.averageOrderValue, scope.workspace.defaultCurrency)}</td><td>{metric.pendingOrderCount}</td><td>{metric.unpaidOrderCount}</td><td>{(metric.cancellationRate * 100).toFixed(1)}%</td></tr>)}</tbody></table></div>
    <div className="mt-6 grid gap-3 md:hidden">{metrics.map(({ stall, metric }) => <article key={stall.id} className="rounded-md border border-stone-200 p-4"><Link href={`/merchant/stalls/${stall.id}/dashboard`} className="font-semibold text-teal-800">{stall.name}</Link><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><Item label="銷售額" value={formatMoney(metric.totalSales, scope.workspace.defaultCurrency)} /><Item label="訂單 / 完成" value={`${metric.orderCount} / ${metric.completedOrderCount}`} /><Item label="待處理 / 未付款" value={`${metric.pendingOrderCount} / ${metric.unpaidOrderCount}`} /><Item label="取消率" value={`${(metric.cancellationRate * 100).toFixed(1)}%`} /></dl></article>)}</div>
  </main>;
}
function Item({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>; }
