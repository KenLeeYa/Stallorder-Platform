import { notFound, redirect } from "next/navigation";
import { Activity, BarChart3, BookOpenCheck, Database } from "lucide-react";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import {
  AdvancedAnalyticsOperationError,
  getAdvancedAnalyticsDashboard,
} from "@/server/analytics/advanced-analytics";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function AdvancedAnalyticsPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "VIEW_REPORTS"))) notFound();
  let dashboard;
  try {
    dashboard = await getAdvancedAnalyticsDashboard(workspace.id);
  } catch (error) {
    if (error instanceof AdvancedAnalyticsOperationError && error.code === "ADVANCED_ANALYTICS_MODULE_DISABLED") notFound();
    throw error;
  }
  const currency = new Intl.NumberFormat("zh-TW", { style: "currency", currency: workspace.defaultCurrency, maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat("zh-TW", { style: "percent", maximumFractionDigits: 1 });
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><BarChart3 className="h-7 w-7 text-teal-700" />進階分析</h1><p className="mt-2 text-sm text-stone-600">近 {dashboard.period.days} 天 · {dashboard.period.dateFrom}～{dashboard.period.dateTo}；所有指標均附定義與來源。</p></header>
      <div className="space-y-6 py-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric label="訂單登記額" value={currency.format(dashboard.metrics.orderEntryAmount)} /><Metric label="訂單數" value={String(dashboard.metrics.orderCount)} /><Metric label="平均完成訂單" value={currency.format(dashboard.metrics.averageOrderValue)} /><Metric label="取消率" value={percent.format(dashboard.metrics.cancellationRate)} /><Metric label="折扣率" value={percent.format(dashboard.metrics.discountRate)} /></section>
        <section className="grid gap-4 lg:grid-cols-2"><article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-semibold"><Activity className="h-5 w-5" />模組資料健康度</h2><dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{[["優惠活動", dashboard.moduleCounts.growthCampaigns], ["食材", dashboard.moduleCounts.supplyIngredients], ["活動推廣", dashboard.moduleCounts.eventCampaigns], ["有效 API Key", dashboard.moduleCounts.apiClients], ["啟用 Webhook", dashboard.moduleCounts.webhookEndpoints]].map(([label, value]) => <div key={label} className="rounded-lg bg-stone-50 p-3"><dt className="text-xs text-stone-500">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}</dl></article><article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-semibold"><Database className="h-5 w-5" />資料新鮮度</h2><p className="mt-3 text-sm text-stone-600">摘要列數：{dashboard.dataFreshness.summaryRows}</p><p className="mt-1 text-sm text-stone-600">最後彙整：{dashboard.dataFreshness.lastCalculatedAt ? new Date(dashboard.dataFreshness.lastCalculatedAt).toLocaleString("zh-TW") : "目前區間尚無資料"}</p></article></section>
        <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpenCheck className="h-5 w-5" />KPI 字典</h2><div className="mt-3 overflow-x-auto"><table className="min-w-[720px] w-full text-left text-sm"><thead className="border-b border-stone-200 text-stone-500"><tr><th className="p-3">中文名稱</th><th className="p-3">定義</th><th className="p-3">資料來源</th></tr></thead><tbody className="divide-y divide-stone-100">{dashboard.dictionary.map((item) => <tr key={item.code}><th className="p-3 font-semibold">{item.label}<span className="mt-1 block font-mono text-xs font-normal text-stone-400">{item.code}</span></th><td className="p-3 text-stone-600">{item.definition}</td><td className="p-3 font-mono text-xs text-stone-500">{item.source}</td></tr>)}</tbody></table></div></section>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><h2 className="font-semibold">判讀限制</h2><ul className="mt-2 list-disc space-y-1 pl-5">{dashboard.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="min-w-0 rounded-xl border border-stone-200 bg-white p-3 shadow-sm"><p className="text-xs text-stone-500 sm:text-sm">{label}</p><p className="mt-1 break-words text-xl font-semibold tabular-nums">{value}</p></article>; }
