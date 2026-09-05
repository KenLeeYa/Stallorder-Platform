"use client";

import Link from "next/link";
import { Banknote, ChartNoAxesCombined, ClipboardList, PackageSearch, SlidersHorizontal, Store, WalletCards } from "lucide-react";
import { useState } from "react";
import { ReportExportButton } from "@/components/report-export-button";
import { useAppLocale } from "@/components/locale-provider";
import { createReportTranslator } from "@/lib/messages/reports";
import type { OperationsPageSize } from "@/lib/operations-pagination";

type Stall = { id: string; name: string };
type DatePreset = "TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "CUSTOM";
type ReportFiltersProps = {
  organizationId: string;
  stalls: Stall[];
  selectedStallIds: string[];
  dateFrom: string;
  dateTo: string;
  multiStallMode: boolean;
  pageSize?: OperationsPageSize;
  showExport?: boolean;
};

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
  return <ReportFiltersForm key={`${props.organizationId}:${props.dateFrom}:${props.dateTo}:${selectionKey}:${props.multiStallMode}`} {...props} />;
}

function ReportFiltersForm({ organizationId, stalls, selectedStallIds, dateFrom, dateTo, multiStallMode, pageSize, showExport = true }: ReportFiltersProps) {
  const { locale } = useAppLocale();
  const t = createReportTranslator(locale);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [selectedIds, setSelectedIds] = useState(selectedStallIds);
  const [preset, setPreset] = useState<DatePreset>(() => inferDatePreset(dateFrom, dateTo));

  function applyPreset(nextPreset: Exclude<DatePreset, "CUSTOM">) {
    const range = dateRangeForPreset(nextPreset);
    setPreset(nextPreset);
    setFrom(range.dateFrom);
    setTo(range.dateTo);
  }

  return <form method="get" className={`grid min-w-0 gap-3 border-b border-stone-200 py-3 sm:gap-4 sm:py-5 lg:items-end ${multiStallMode ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]" : ""}`}>
    <input type="hidden" name="organizationId" value={organizationId} />
    {pageSize ? <input type="hidden" name="pageSize" value={pageSize} /> : null}
    <div className="min-w-0 max-w-full overflow-x-hidden">
      <span className="text-sm font-medium text-stone-700">{t("reports.filter.dateRange")}</span>
      <div data-testid="report-date-action-scroll" className="relative mt-2 w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
        <div data-testid="report-date-action-row" className="flex w-max min-w-full flex-nowrap items-center gap-1 pb-1 sm:gap-2">
          {(["TODAY", "YESTERDAY", "WEEK", "MONTH", "CUSTOM"] as const).map((value) => <button key={value} type="button" aria-pressed={preset === value} onClick={() => value === "CUSTOM" ? setPreset("CUSTOM") : applyPreset(value)} className={`min-h-11 min-w-11 shrink-0 rounded-md px-1 text-xs font-semibold sm:min-w-0 sm:px-3 ${preset === value ? "bg-stone-900 text-white" : "border border-stone-300 bg-white hover:bg-stone-100"}`}>{value === "TODAY" ? t("reports.filter.day") : value === "YESTERDAY" ? t("reports.filter.yesterday") : value === "WEEK" ? t("reports.filter.week") : value === "MONTH" ? t("reports.filter.month") : t("reports.filter.custom")}</button>)}
          <div data-testid="report-filter-actions" className="ml-auto flex shrink-0 gap-1 sm:gap-2">
            <button type="submit" title={t("reports.filter.apply")} aria-label={t("reports.filter.apply")} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-2 text-sm font-semibold text-white sm:px-4"><SlidersHorizontal className="h-4 w-4" /><span className="sr-only sm:not-sr-only">{t("reports.filter.apply")}</span></button>
            {showExport ? <ReportExportButton organizationId={organizationId} stallIds={selectedIds} dateFrom={from} dateTo={to} /> : null}
          </div>
        </div>
      </div>
      {preset === "CUSTOM" ? <div className="mt-2 grid gap-2 min-[360px]:grid-cols-[1fr_auto_1fr] min-[360px]:items-center">
        <input required aria-label={t("reports.filter.startDate")} type="date" name="dateFrom" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-11 min-w-0 rounded-md border border-stone-300 px-3" />
        <span className="text-center text-xs text-stone-600 min-[360px]:text-sm">{t("reports.filter.to")}</span>
        <input required aria-label={t("reports.filter.endDate")} type="date" name="dateTo" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-11 min-w-0 rounded-md border border-stone-300 px-3" />
      </div> : <><input type="hidden" name="dateFrom" value={from} /><input type="hidden" name="dateTo" value={to} /><p className="mt-2 text-sm text-stone-600">{from} {t("reports.filter.to")} {to}</p></>}
    </div>
    {multiStallMode ? <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-stone-700">{t("reports.filter.stalls")}</legend>
      <div className="mt-1 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2">{stalls.map((stall) => <label key={stall.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="stallId" value={stall.id} checked={selectedIds.includes(stall.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, stall.id] : current.filter((id) => id !== stall.id))} />{stall.name}</label>)}</div>
    </fieldset> : null}
  </form>;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRangeForPreset(preset: Exclude<DatePreset, "CUSTOM">, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  if (preset === "YESTERDAY") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  if (preset === "WEEK") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (preset === "MONTH") start.setDate(1);
  return { dateFrom: formatLocalDate(start), dateTo: formatLocalDate(end) };
}

function inferDatePreset(dateFrom: string, dateTo: string): DatePreset {
  for (const preset of ["TODAY", "YESTERDAY", "WEEK", "MONTH"] as const) {
    const range = dateRangeForPreset(preset);
    if (range.dateFrom === dateFrom && range.dateTo === dateTo) return preset;
  }
  return "CUSTOM";
}
