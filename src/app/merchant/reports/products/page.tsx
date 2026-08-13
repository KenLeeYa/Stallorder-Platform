import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppNumber } from "@/lib/locale-format";
import { createReportTranslator } from "@/lib/messages/reports";
import { getProductAndHourlyReport } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[]; dateFrom?: string; dateTo?: string }> };

export default async function ProductReportPage({ searchParams }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = createReportTranslator(locale);
  const scope = await requireReportScope(await searchParams);
  const featureAccess = await getFeatureAccess(scope.workspace.id, "PRODUCT_SALES_REPORT", {
    requireUsableSubscription: false,
  });
  if (!featureAccess.allowed) {
    return <FeatureUpgradeNotice title={t("reports.products.title")} message={featureAccess.message} billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`} returnHref={`/merchant/reports/overview?organizationId=${scope.workspace.id}`} returnLabel={t("reports.nav.overview")} />;
  }
  const report = await getProductAndHourlyReport(scope.workspace.id, scope.stalls.map((stall) => stall.id), scope.dateFrom, scope.dateTo);
  const organizationProducts = new Map<string, { quantity: number; revenue: number }>();
  for (const row of report.products) { const current = organizationProducts.get(row.productName) ?? { quantity: 0, revenue: 0 }; organizationProducts.set(row.productName, { quantity: current.quantity + row.quantity, revenue: current.revenue + row.revenue }); }
  const topProducts = [...organizationProducts.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  return <main data-testid="report-products" className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <div><p className="text-sm font-semibold text-teal-800">{t("reports.eyebrow")}</p><h1 className="mt-1 text-3xl font-semibold">{t("reports.products.title")}</h1><p className="mt-2 text-sm text-stone-600">{t("reports.products.description")}</p></div>
    <ReportNavigation organizationId={scope.workspace.id} active="products" /><ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <section className="grid gap-8 py-7 lg:grid-cols-2"><div><h2 className="text-xl font-semibold">{t("reports.products.organizationTop")}</h2><div className="mt-3 divide-y divide-stone-100 border-y border-stone-200">{topProducts.map((product, index) => <div key={product.name} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-x-2 gap-y-1 py-3 text-sm sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center"><span className="row-span-2 text-stone-600 sm:row-span-1">{formatAppNumber(locale, index + 1)}</span><span className="min-w-0 break-words font-medium">{product.name}<span className="ml-2 whitespace-nowrap text-stone-500">{t("reports.count.items", { count: formatAppNumber(locale, product.quantity) })}</span></span><strong className="col-start-2 break-words tabular-nums sm:col-start-auto">{formatAppCurrency(locale, product.revenue, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</strong></div>)}{topProducts.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">{t("reports.products.none")}</p> : null}</div></div>
      <div><h2 className="text-xl font-semibold">{t("reports.products.stallTop")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{scope.stalls.map((stall) => <div key={stall.id} className="py-4"><h3 className="break-words font-semibold">{stall.name}</h3>{report.products.filter((row) => row.stallId === stall.id).slice(0, 5).map((row) => <div key={row.productName} className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm"><span className="break-words">{row.productName} · {t("reports.count.items", { count: formatAppNumber(locale, row.quantity) })}</span><strong className="break-words text-right tabular-nums">{formatAppCurrency(locale, row.revenue, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</strong></div>)}</div>)}</div></div>
    </section>
    <section className="pb-8"><h2 className="text-xl font-semibold">{t("reports.products.hourly")}</h2>{report.hours.length > 0 ? <ul data-testid="product-hourly-dashboard" className="mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-stone-200 bg-white min-[360px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">{report.hours.map((row) => <li key={`${row.stallId}-${row.hour}`} className="min-w-0 border-b border-r border-stone-200 bg-white p-3 text-sm"><p className="font-semibold tabular-nums text-teal-800">{String(row.hour).padStart(2, "0")}:00</p><p className="mt-1 break-words text-xs text-stone-600">{row.stallName}</p><p className="mt-2 tabular-nums text-stone-500">{t("reports.count.orders", { count: formatAppNumber(locale, row.orderCount) })}</p><strong className="mt-1 block break-words tabular-nums">{formatAppCurrency(locale, row.sales, scope.workspace.defaultCurrency, { maximumFractionDigits: 0 })}</strong></li>)}</ul> : <p className="mt-3 border-y border-stone-200 py-8 text-center text-sm text-stone-500">{t("reports.products.noHourly")}</p>}</section>
  </main>;
}
