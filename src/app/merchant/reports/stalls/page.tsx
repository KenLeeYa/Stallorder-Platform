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
  return <main data-testid="report-stalls" className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">跨攤位報表</p><h1 className="mt-1 text-3xl font-semibold">攤位績效比較</h1><p className="mt-2 text-sm text-stone-600">銷售、訂單、未付款與取消率比較。</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="stalls" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <div data-testid="stall-performance-table" className="mt-6 hidden lg:block"><table className="w-full table-fixed border-y border-stone-200 text-left text-sm"><thead className="text-stone-500"><tr><th className="px-2 py-3">攤位</th><th className="px-2">銷售額</th><th className="px-2">訂單</th><th className="px-2">完成</th><th className="px-2">平均客單</th><th className="px-2">待處理</th><th className="px-2">未付款</th><th className="px-2">取消率</th></tr></thead><tbody>{metrics.map(({ stall, metric }) => <tr key={stall.id} className="border-t border-stone-100"><td className="break-words px-2 py-4"><Link href={`/merchant/stalls/${stall.id}/dashboard`} className="font-semibold text-teal-800">{stall.name}</Link></td><td className="break-words px-2 tabular-nums">{formatMoney(metric.totalSales, scope.workspace.defaultCurrency)}</td><td className="px-2 tabular-nums">{metric.orderCount}</td><td className="px-2 tabular-nums">{metric.completedOrderCount}</td><td className="break-words px-2 tabular-nums">{formatMoney(metric.averageOrderValue, scope.workspace.defaultCurrency)}</td><td className="px-2 tabular-nums">{metric.pendingOrderCount}</td><td className="px-2 tabular-nums">{metric.unpaidOrderCount}</td><td className="px-2 tabular-nums">{(metric.cancellationRate * 100).toFixed(1)}%</td></tr>)}</tbody></table></div>
    <div data-testid="stall-performance-dashboard" className="mt-6 grid gap-3 md:grid-cols-2 lg:hidden">{metrics.map(({ stall, metric }) => <article key={stall.id} data-testid="stall-performance-card" className="min-w-0 overflow-hidden rounded-lg border border-stone-200"><div className="px-3 py-3"><Link href={`/merchant/stalls/${stall.id}/dashboard`} className="break-words font-semibold text-teal-800">{stall.name}</Link></div><dl className="grid grid-cols-2 border-t border-stone-200 bg-white min-[360px]:grid-cols-3 sm:grid-cols-4"><Item label="銷售額" value={formatMoney(metric.totalSales, scope.workspace.defaultCurrency)} /><Item label="訂單" value={String(metric.orderCount)} /><Item label="完成" value={String(metric.completedOrderCount)} /><Item label="平均客單" value={formatMoney(metric.averageOrderValue, scope.workspace.defaultCurrency)} /><Item label="待處理" value={String(metric.pendingOrderCount)} /><Item label="未付款" value={String(metric.unpaidOrderCount)} /><Item wide label="取消率" value={`${(metric.cancellationRate * 100).toFixed(1)}%`} /></dl></article>)}</div>
  </main>;
}
function Item({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) { return <div className={`min-w-0 border-b border-r border-stone-200 bg-white p-3 ${wide ? "col-span-2 min-[360px]:col-span-3 sm:col-span-2" : ""}`}><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold tabular-nums">{value}</dd></div>; }
