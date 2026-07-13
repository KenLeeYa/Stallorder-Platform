import Link from "next/link";

type Stall = { id: string; name: string };

export function ReportNavigation({ organizationId, active }: { organizationId: string; active: "overview" | "stalls" | "products" | "payments" }) {
  const items = [
    ["overview", "趨勢總覽"],
    ["stalls", "攤位比較"],
    ["products", "商品分析"],
    ["payments", "付款分析"],
  ] as const;
  return <nav aria-label="報表分類" className="flex gap-1 overflow-x-auto border-b border-stone-200">{items.map(([key, label]) => <Link key={key} href={`/merchant/reports/${key}?organizationId=${organizationId}`} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold ${active === key ? "border-teal-700 text-teal-800" : "border-transparent text-stone-600"}`}>{label}</Link>)}</nav>;
}

export function ReportFilters({ organizationId, stalls, selectedStallIds, dateFrom, dateTo }: { organizationId: string; stalls: Stall[]; selectedStallIds: string[]; dateFrom: string; dateTo: string }) {
  return <form method="get" className="grid gap-4 border-b border-stone-200 py-5 lg:grid-cols-[1fr_1fr_minmax(260px,2fr)_auto] lg:items-end"><input type="hidden" name="organizationId" value={organizationId} /><label className="text-sm font-medium text-stone-700">開始日期<input required type="date" name="dateFrom" defaultValue={dateFrom} className="mt-1 block h-10 w-full rounded-md border border-stone-300 px-3" /></label><label className="text-sm font-medium text-stone-700">結束日期<input required type="date" name="dateTo" defaultValue={dateTo} className="mt-1 block h-10 w-full rounded-md border border-stone-300 px-3" /></label><fieldset><legend className="text-sm font-medium text-stone-700">攤位範圍</legend><div className="mt-1 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2">{stalls.map((stall) => <label key={stall.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="stallId" value={stall.id} defaultChecked={selectedStallIds.includes(stall.id)} />{stall.name}</label>)}</div></fieldset><button type="submit" className="min-h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white">套用篩選</button></form>;
}
