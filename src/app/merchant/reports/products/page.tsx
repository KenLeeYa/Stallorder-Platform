import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { formatMoney } from "@/lib/money";
import { getProductAndHourlyReport } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function ProductReportPage({ searchParams }: PageProps) {
  const scope = await requireReportScope(await searchParams);
  const featureAccess = await getFeatureAccess(scope.workspace.id, "PRODUCT_SALES_REPORT", {
    requireUsableSubscription: false,
  });
  if (!featureAccess.allowed) {
    return <FeatureUpgradeNotice title="商品銷售報表尚未開放" message={featureAccess.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} />;
  }
  const report = await getProductAndHourlyReport(scope.workspace.id, scope.stalls.map((stall) => stall.id), scope.dateFrom, scope.dateTo);
  const organizationProducts = new Map<string, { quantity: number; revenue: number }>();
  for (const row of report.products) { const current = organizationProducts.get(row.productName) ?? { quantity: 0, revenue: 0 }; organizationProducts.set(row.productName, { quantity: current.quantity + row.quantity, revenue: current.revenue + row.revenue }); }
  const topProducts = [...organizationProducts.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">跨攤位報表</p><h1 className="mt-1 text-3xl font-semibold">商品與時段分析</h1><p className="mt-2 text-sm text-stone-600">使用訂單成立時的商品名稱與成交單價快照。</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="products" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <section className="grid gap-8 py-7 lg:grid-cols-2"><div><h2 className="text-xl font-semibold">全組織熱銷商品</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{topProducts.map((product, index) => <div key={product.name} className="grid grid-cols-[32px_1fr_auto] gap-3 py-3 text-sm"><span className="text-stone-400">{index + 1}</span><span>{product.name}<span className="ml-2 text-stone-500">{product.quantity} 份</span></span><strong>{formatMoney(product.revenue, scope.workspace.defaultCurrency)}</strong></div>)}{topProducts.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">此區間尚無已完成商品銷售。</p> : null}</div></div>
      <div><h2 className="text-xl font-semibold">各攤熱銷商品</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{scope.stalls.map((stall) => <div key={stall.id} className="py-4"><h3 className="font-semibold">{stall.name}</h3>{report.products.filter((row) => row.stallId === stall.id).slice(0, 5).map((row) => <div key={row.productName} className="mt-2 flex justify-between gap-3 text-sm"><span>{row.productName} · {row.quantity} 份</span><strong>{formatMoney(row.revenue, scope.workspace.defaultCurrency)}</strong></div>)}</div>)}</div></div>
    </section>
    <section className="pb-8"><h2 className="text-xl font-semibold">每小時銷售比較</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{report.hours.map((row) => <div key={`${row.stallId}-${row.hour}`} className="grid grid-cols-[70px_1fr_auto_auto] gap-3 py-3 text-sm"><span>{String(row.hour).padStart(2, "0")}:00</span><span>{row.stallName}</span><span>{row.orderCount} 筆</span><strong>{formatMoney(row.sales, scope.workspace.defaultCurrency)}</strong></div>)}{report.hours.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">此區間尚無時段資料。</p> : null}</div></section>
  </main>;
}
