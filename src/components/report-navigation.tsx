"use client";

import Link from "next/link";
import { Banknote, ChartNoAxesCombined, ClipboardList, PackageSearch, Store, WalletCards } from "lucide-react";
import { useState } from "react";
import { ReportExportButton } from "@/components/report-export-button";
import { useAppLocale } from "@/components/locale-provider";
import { createReportTranslator } from "@/lib/messages/reports";
import type { OperationsPageSize } from "@/lib/operations-pagination";

type Stall = { id: string; name: string };
type ReportFiltersProps = { organizationId: string; stalls: Stall[]; selectedStallIds: string[]; dateFrom: string; dateTo: string; pageSize?: OperationsPageSize };

export function ReportNavigation({ organizationId, active }: { organizationId: string; active: "overview" | "orders" | "stalls" | "products" | "payments" | "cash-shifts" }) {
  const { locale } = useAppLocale();
  const t = createReportTranslator(locale);
  const items = [
    ["overview", t("reports.nav.overview"), ChartNoAxesCombined],
    ["orders", t("reports.nav.orders"), ClipboardList],
    ["stalls", t("reports.nav.stalls"), Store],
    ["products", t("reports.nav.products"), PackageSearch],
    ["payments", t("reports.nav.payments"), WalletCards],
    ["cash-shifts", t("reports.nav.cashShifts"), Banknote],
  ] as const;
  return <nav data-testid="report-navigation" aria-label={t("reports.nav")} className="flex w-full flex-nowrap overflow-x-auto overscroll-x-contain border-b border-stone-200 md:gap-1">{items.map(([key, label, Icon]) => <Link key={key} href={`/merchant/reports/${key}?organizationId=${organizationId}`} title={label} aria-current={active === key ? "page" : undefined} className={`flex min-h-11 min-w-11 flex-1 shrink-0 items-center justify-center border-b-2 px-1 py-2 text-sm font-semibold md:flex-none md:gap-2 md:px-3 md:py-3 ${active === key ? "border-teal-700 text-teal-800" : "border-transparent text-stone-700"}`}><Icon className="h-5 w-5 shrink-0" /><span className="sr-only md:not-sr-only">{label}</span></Link>)}</nav>;
}

export function ReportFilters(props: ReportFiltersProps) {
  const selectionKey = props.selectedStallIds.join(",");
  return <ReportFiltersForm key={`${props.organizationId}:${props.dateFrom}:${props.dateTo}:${selectionKey}`} {...props} />;
}

function ReportFiltersForm({ organizationId, stalls, selectedStallIds, dateFrom, dateTo, pageSize }: ReportFiltersProps) {
  const { locale } = useAppLocale();
  const t = createReportTranslator(locale);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [selectedIds, setSelectedIds] = useState(selectedStallIds);

  function applyPreset(preset: "day" | "week" | "month") {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (preset === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (preset === "month") start.setDate(1);
    setFrom(formatLocalDate(start));
    setTo(formatLocalDate(today));
  }

  return <form method="get" className="grid gap-3 border-b border-stone-200 py-3 sm:gap-4 sm:py-5 lg:grid-cols-[minmax(340px,1.2fr)_minmax(260px,1fr)_auto] lg:items-end"><input type="hidden" name="organizationId" value={organizationId} />{pageSize ? <input type="hidden" name="pageSize" value={pageSize} /> : null}<div><div className="flex items-center justify-between gap-2 sm:gap-3"><span className="text-sm font-medium text-stone-700">{t("reports.filter.dateRange")}</span><div className="inline-flex overflow-hidden rounded-md border border-stone-300"><button type="button" onClick={() => applyPreset("day")} className="h-8 border-r border-stone-300 px-3 text-xs font-semibold hover:bg-stone-100">{t("reports.filter.day")}</button><button type="button" onClick={() => applyPreset("week")} className="h-8 border-r border-stone-300 px-3 text-xs font-semibold hover:bg-stone-100">{t("reports.filter.week")}</button><button type="button" onClick={() => applyPreset("month")} className="h-8 px-3 text-xs font-semibold hover:bg-stone-100">{t("reports.filter.month")}</button></div></div><div className="mt-1 grid gap-2 min-[360px]:grid-cols-[1fr_auto_1fr] min-[360px]:items-center"><input required aria-label={t("reports.filter.startDate")} type="date" name="dateFrom" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 min-w-0 rounded-md border border-stone-300 px-3" /><span className="text-center text-xs text-stone-600 min-[360px]:text-sm">{t("reports.filter.to")}</span><input required aria-label={t("reports.filter.endDate")} type="date" name="dateTo" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 min-w-0 rounded-md border border-stone-300 px-3" /></div></div><fieldset><legend className="text-sm font-medium text-stone-700">{t("reports.filter.stalls")}</legend><div className="mt-1 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2">{stalls.map((stall) => <label key={stall.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="stallId" value={stall.id} checked={selectedIds.includes(stall.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, stall.id] : current.filter((id) => id !== stall.id))} />{stall.name}</label>)}</div></fieldset><div className="flex flex-wrap gap-2"><button type="submit" className="min-h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white">{t("reports.filter.apply")}</button><ReportExportButton organizationId={organizationId} stallIds={selectedIds} dateFrom={from} dateTo={to} /></div></form>;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
