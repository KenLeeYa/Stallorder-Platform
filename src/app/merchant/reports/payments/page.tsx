import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireReportScope } from "@/lib/report-scope";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function PaymentReportPage({ searchParams }: PageProps) {
  const scope = await requireReportScope(await searchParams);
  const rows = await prisma.dailyStallSummary.findMany({ where: { organizationId: scope.workspace.id, stallId: { in: scope.stalls.map((stall) => stall.id) }, businessDate: { gte: new Date(`${scope.dateFrom}T00:00:00Z`), lte: new Date(`${scope.dateTo}T00:00:00Z`) } } });
  const total = aggregateDailyMetrics(rows);
  const metrics = scope.stalls.map((stall) => ({ stall, metric: aggregateDailyMetrics(rows.filter((row) => row.stallId === stall.id)) }));
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">跨攤位報表</p><h1 className="mt-1 text-3xl font-semibold">付款分析</h1><p className="mt-2 text-sm text-stone-600">目前人工結帳預設記錄為現金付款。</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="payments" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <section className="grid border-b border-stone-200 sm:grid-cols-2 lg:grid-cols-4"><Metric label="現金" value={formatMoney(total.cashAmount, scope.workspace.defaultCurrency)} /><Metric label="人工轉帳" value={formatMoney(total.manualTransferAmount, scope.workspace.defaultCurrency)} /><Metric label="其他付款" value={formatMoney(total.otherPaymentAmount, scope.workspace.defaultCurrency)} /><Metric label="未付款訂單" value={String(total.unpaidOrderCount)} /></section>
    <section className="py-7"><h2 className="text-xl font-semibold">各攤付款方式</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{metrics.map(({ stall, metric }) => <div key={stall.id} className="grid gap-2 py-4 text-sm sm:grid-cols-[1fr_repeat(4,minmax(100px,auto))]"><strong>{stall.name}</strong><span>現金 {formatMoney(metric.cashAmount, scope.workspace.defaultCurrency)}</span><span>轉帳 {formatMoney(metric.manualTransferAmount, scope.workspace.defaultCurrency)}</span><span>其他 {formatMoney(metric.otherPaymentAmount, scope.workspace.defaultCurrency)}</span><span>未付款 {metric.unpaidOrderCount}</span></div>)}</div></section>
  </main>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="border-t border-stone-200 py-5 sm:px-4 lg:border-t-0"><div className="text-sm text-stone-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>; }
