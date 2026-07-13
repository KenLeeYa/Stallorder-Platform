import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, CirclePause, CircleStop, Store } from "lucide-react";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

const statusLabels = {
  OPEN: "營業中",
  PAUSED: "已暫停",
  CLOSED: "已關閉",
  SOLD_OUT: "全攤售罄",
} as const;

export default async function MerchantDashboardPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.canUseAllStalls) notFound();

  const activeStalls = workspace.stalls.filter((stall) => stall.isActive);
  const openCount = activeStalls.filter((stall) => stall.businessStatus === "OPEN").length;
  const pausedCount = activeStalls.filter((stall) => stall.businessStatus === "PAUSED").length;
  const closedCount = activeStalls.length - openCount - pausedCount;

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold text-teal-800">組織工作區</p>
          <h1 className="mt-1 text-3xl font-semibold">{workspace.businessName}</h1>
          <p className="mt-2 text-sm text-stone-600">全部授權攤位的即時營運狀態。</p>
        </div>
        <Link href={`/merchant/stalls?organizationId=${workspace.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white">
          管理攤位 <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <section className="grid border-b border-stone-200 sm:grid-cols-3" aria-label="攤位營業狀態摘要">
        <div className="flex items-center gap-3 py-5 sm:border-r sm:border-stone-200 sm:px-5 sm:first:pl-0"><Store className="h-5 w-5 text-emerald-700" /><div><div className="text-2xl font-semibold">{openCount}</div><div className="text-sm text-stone-500">營業中</div></div></div>
        <div className="flex items-center gap-3 border-t border-stone-200 py-5 sm:border-r sm:border-t-0 sm:px-5"><CirclePause className="h-5 w-5 text-amber-700" /><div><div className="text-2xl font-semibold">{pausedCount}</div><div className="text-sm text-stone-500">暫停中</div></div></div>
        <div className="flex items-center gap-3 border-t border-stone-200 py-5 sm:border-t-0 sm:pl-5"><CircleStop className="h-5 w-5 text-stone-600" /><div><div className="text-2xl font-semibold">{closedCount}</div><div className="text-sm text-stone-500">關閉或售罄</div></div></div>
      </section>

      <section className="py-7">
        <div className="flex items-end justify-between gap-4"><h2 className="text-xl font-semibold">攤位狀態</h2></div>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {activeStalls.map((stall) => (
            <div key={stall.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="font-semibold">{stall.name}</div><div className="mt-1 text-sm text-stone-500">{stall.code}</div></div>
              <div className="flex items-center gap-3"><span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{statusLabels[stall.businessStatus]}</span><Link href={`/merchant/${stall.slug}`} className="text-sm font-semibold text-teal-800">開啟攤位</Link></div>
            </div>
          ))}
        </div>
        {activeStalls.length === 0 ? <p className="mt-6 text-sm text-stone-600">目前沒有啟用中的攤位。</p> : null}
      </section>
    </main>
  );
}
