import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { requireReportScope } from "@/lib/report-scope";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function ReportOverviewPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const scope = await requireReportScope(query);
  const rows = await prisma.dailyStallSummary.findMany({
    where: {
      organizationId: scope.workspace.id,
      stallId: { in: scope.stalls.map((stall) => stall.id) },
      businessDate: { gte: new Date(`${scope.dateFrom}T00:00:00Z`), lte: new Date(`${scope.dateTo}T00:00:00Z`) },
    },
    orderBy: { businessDate: "asc" },
  });
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

  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">跨攤位報表</p><h1 className="mt-1 text-3xl font-semibold">銷售趨勢總覽</h1><p className="mt-2 text-sm text-stone-600">{scope.workspace.businessName} · {scope.dateFrom} 至 {scope.dateTo}</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="overview" />
    <ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <section className="grid border-b border-stone-200 sm:grid-cols-2 lg:grid-cols-4"><Metric label="淨銷售額" value={formatMoney(total.totalSales, scope.workspace.defaultCurrency)} /><Metric label="訂單數" value={String(total.orderCount)} /><Metric label="平均客單價" value={formatMoney(total.averageOrderValue, scope.workspace.defaultCurrency)} /><Metric label="取消率" value={`${(total.cancellationRate * 100).toFixed(1)}%`} /></section>
    <section className="grid gap-8 py-7 lg:grid-cols-2">
      <div><h2 className="text-xl font-semibold">每日趨勢</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{daily.map((row) => <div key={row.businessDate} className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm"><span>{row.businessDate}</span><span>{row.orderCount} 筆</span><strong>{formatMoney(row.totalSales, scope.workspace.defaultCurrency)}</strong></div>)}{daily.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">此區間尚無銷售資料。</p> : null}</div></div>
      <div><h2 className="text-xl font-semibold">每週趨勢</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{[...weeks.entries()].map(([week, weekRows]) => { const metric = aggregateDailyMetrics(weekRows); return <div key={week} className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm"><span>{week} 起</span><span>{metric.orderCount} 筆</span><strong>{formatMoney(metric.totalSales, scope.workspace.defaultCurrency)}</strong></div>; })}{weeks.size === 0 ? <p className="py-8 text-center text-sm text-stone-500">此區間尚無每週資料。</p> : null}</div></div>
    </section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border-t border-stone-200 py-5 sm:px-4 lg:border-t-0"><div className="text-sm text-stone-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>; }
function weekStart(date: Date) { const copy = new Date(date); copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7)); return copy.toISOString().slice(0, 10); }
