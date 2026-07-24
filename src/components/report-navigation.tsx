"use client";

import Link from "next/link";
import { useState } from "react";
import { ReportExportButton } from "@/components/report-export-button";

type Stall = { id: string; name: string };

export function ReportNavigation({ organizationId, active }: { organizationId: string; active: "overview" | "stalls" | "products" | "payments" | "cash-shifts" }) {
  const items = [
    ["overview", "趨勢總覽"],
    ["stalls", "攤位比較"],
    ["products", "商品分析"],
    ["payments", "付款分析"],
    ["cash-shifts", "現金交班"],
  ] as const;
  return <nav aria-label="報表分類" className="flex gap-1 overflow-x-auto border-b border-stone-200">{items.map(([key, label]) => <Link key={key} href={`/merchant/reports/${key}?organizationId=${organizationId}`} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold ${active === key ? "border-teal-700 text-teal-800" : "border-transparent text-stone-600"}`}>{label}</Link>)}</nav>;
}

export function ReportFilters({ organizationId, stalls, selectedStallIds, dateFrom, dateTo }: { organizationId: string; stalls: Stall[]; selectedStallIds: string[]; dateFrom: string; dateTo: string }) {
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);

  function applyPreset(preset: "day" | "week" | "month") {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (preset === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (preset === "month") start.setDate(1);
    setFrom(formatLocalDate(start));
    setTo(formatLocalDate(today));
  }

  return <form method="get" className="grid gap-4 border-b border-stone-200 py-5 lg:grid-cols-[minmax(340px,1.2fr)_minmax(260px,1fr)_auto] lg:items-end"><input type="hidden" name="organizationId" value={organizationId} /><div><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-stone-700">日期區間</span><div className="inline-flex overflow-hidden rounded-md border border-stone-300"><button type="button" onClick={() => applyPreset("day")} className="h-8 border-r border-stone-300 px-3 text-xs font-semibold hover:bg-stone-100">日</button><button type="button" onClick={() => applyPreset("week")} className="h-8 border-r border-stone-300 px-3 text-xs font-semibold hover:bg-stone-100">週</button><button type="button" onClick={() => applyPreset("month")} className="h-8 px-3 text-xs font-semibold hover:bg-stone-100">月</button></div></div><div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><input required aria-label="開始日期" type="date" name="dateFrom" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 min-w-0 rounded-md border border-stone-300 px-3" /><span className="text-stone-400">至</span><input required aria-label="結束日期" type="date" name="dateTo" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 min-w-0 rounded-md border border-stone-300 px-3" /></div></div><fieldset><legend className="text-sm font-medium text-stone-700">攤位範圍</legend><div className="mt-1 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2">{stalls.map((stall) => <label key={stall.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="stallId" value={stall.id} defaultChecked={selectedStallIds.includes(stall.id)} />{stall.name}</label>)}</div></fieldset><div className="flex flex-wrap gap-2"><button type="submit" className="min-h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white">套用篩選</button><ReportExportButton organizationId={organizationId} stallIds={selectedStallIds} dateFrom={from} dateTo={to} /></div></form>;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
