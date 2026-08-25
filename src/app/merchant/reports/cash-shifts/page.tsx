import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { ReportPageNavigation, ReportPageSizeSelect } from "@/components/report-pagination-controls";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDateTime, formatAppNumber } from "@/lib/locale-format";
import { createReportTranslator } from "@/lib/messages/reports";
import { parseOperationsPage, parseOperationsPageSize } from "@/lib/operations-pagination";
import { getPaginatedCashShiftReport } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = {
  searchParams: Promise<{
    organizationId?: string;
    stallId?: string | string[];
    dateFrom?: string;
    dateTo?: string;
    page?: string;
    pageSize?: string;
  }>;
};

export default async function CashShiftReportPage({ searchParams }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = createReportTranslator(locale);
  const query = await searchParams;
  const scope = await requireReportScope(query);
  const featureAccess = await getFeatureAccess(scope.workspace.id, "CASH_SHIFT");
  if (!featureAccess.allowed) {
    return <FeatureUpgradeNotice
      title={t("reports.cash.title")}
      message={featureAccess.message}
      billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`}
    />;
  }
  const { rows, pagination, summary } = await getPaginatedCashShiftReport(
    scope.workspace.id,
    scope.stalls.map((stall) => stall.id),
    scope.dateFrom,
    scope.dateTo,
    { page: parseOperationsPage(query.page), pageSize: parseOperationsPageSize(query.pageSize) },
  );
  const currency = scope.workspace.defaultCurrency;

  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <header><p className="text-sm font-semibold text-teal-800">{t("reports.eyebrow")}</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{t("reports.cash.title")}</h1><p className="mt-2 text-sm text-stone-600">{t("reports.cash.description")}</p></header>
    <ReportNavigation organizationId={scope.workspace.id} active="cash-shifts" />
    <ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} pageSize={pagination.pageSize} />
    <section aria-label={t("reports.cash.summary")} data-testid="cash-shift-report-dashboard" className="grid grid-cols-2 gap-2 border-b border-stone-200 py-5 sm:grid-cols-3 lg:grid-cols-6">
      <SummaryMetric label={t("reports.cash.shifts")} value={t("reports.count.shifts", { count: formatAppNumber(locale, pagination.total) })} />
      <SummaryMetric label={t("reports.cash.sales")} value={formatAppCurrency(locale, summary.cashSales, currency, { maximumFractionDigits: 0 })} />
      <SummaryMetric label={t("reports.cash.refunds")} value={formatAppCurrency(locale, summary.cashRefunds, currency, { maximumFractionDigits: 0 })} />
      <SummaryMetric label={t("reports.cash.expected")} value={formatAppCurrency(locale, summary.expected, currency, { maximumFractionDigits: 0 })} />
      <SummaryMetric label={t("reports.cash.variance")} value={formatSignedMoney(summary.difference, currency, locale)} alert={summary.difference !== 0} />
      <SummaryMetric label={t("reports.cash.review")} value={t("reports.count.shifts", { count: formatAppNumber(locale, summary.reviewRequired) })} alert={summary.reviewRequired > 0} />
    </section>
    <section id="cash-shifts-list" className="py-7">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{t("reports.cash.details")}</h2><ReportPageSizeSelect label={t("reports.cash.details")} pagination={pagination} anchorId="cash-shifts-list" /></div>
      <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
        {rows.map((row) => <article key={row.id} className="min-w-0 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><strong className="break-words">{row.stallName}</strong><p className="mt-1 break-words text-xs text-stone-500">{row.openedByName} · {formatAppDateTime(locale, row.openedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}{row.closedAt ? ` ${t("reports.filter.to")} ${formatAppDateTime(locale, row.closedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}` : ""}</p></div><span className="rounded bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{t(statusKey(row.status))}</span></div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4 lg:grid-cols-8">
            <Amount label={t("reports.cash.opening")} value={row.openingAmount} currency={currency} locale={locale} />
            <Amount label={t("reports.cash.sales")} value={row.cashSales} currency={currency} locale={locale} />
            <Amount label={t("reports.cash.refunds")} value={-row.cashRefunds} currency={currency} locale={locale} signed />
            <Amount label={t("reports.cash.inOut")} value={row.cashIn - row.cashOut} currency={currency} locale={locale} signed />
            <Amount label={t("reports.cash.correction")} value={row.corrections} currency={currency} locale={locale} signed />
            <Amount label={t("reports.cash.expected")} value={row.expectedAmount} currency={currency} locale={locale} />
            <Amount label={t("reports.cash.counted")} value={row.actualAmount} currency={currency} locale={locale} />
            <Amount label={t("reports.cash.variance")} value={row.differenceAmount} currency={currency} locale={locale} signed alert={(row.differenceAmount ?? 0) !== 0} />
          </dl>
          {row.latestReviewDecision ? <p className="mt-3 text-xs text-stone-600">{t("reports.cash.latestReview", { decision: t(reviewKey(row.latestReviewDecision)) })}{row.latestReviewerName ? ` · ${row.latestReviewerName}` : ""}</p> : null}
        </article>)}
      </div>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{t("reports.cash.none")}</p> : null}
      <ReportPageNavigation label={t("reports.cash.details")} pagination={pagination} anchorId="cash-shifts-list" />
    </section>
  </main>;
}

function SummaryMetric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={`min-w-0 rounded-lg border p-3 shadow-sm ${alert ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-white"}`}><div className="text-xs text-stone-500 sm:text-sm">{label}</div><div className={`mt-1 break-words text-lg font-semibold sm:text-xl ${alert ? "text-amber-800" : "text-stone-950"}`}>{value}</div></div>;
}

function Amount({ label, value, currency, locale, signed = false, alert = false }: { label: string; value: number | null; currency: string; locale: Awaited<ReturnType<typeof getRequestAppLocale>>["locale"]; signed?: boolean; alert?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs text-stone-500">{label}</dt><dd className={`mt-1 break-words font-semibold ${alert ? "text-amber-800" : "text-stone-900"}`}>{value === null ? "-" : signed ? formatSignedMoney(value, currency, locale) : formatAppCurrency(locale, value, currency, { maximumFractionDigits: 0 })}</dd></div>;
}

function formatSignedMoney(amount: number, currency: string, locale: Awaited<ReturnType<typeof getRequestAppLocale>>["locale"]) {
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${formatAppCurrency(locale, Math.abs(amount), currency, { maximumFractionDigits: 0 })}`;
}

function statusKey(status: "OPEN" | "CLOSING" | "REVIEW_REQUIRED" | "CLOSED") {
  const keys = {
    OPEN: "reports.cash.status.open",
    CLOSING: "reports.cash.status.closing",
    REVIEW_REQUIRED: "reports.cash.status.reviewRequired",
    CLOSED: "reports.cash.status.closed",
  } as const;
  return keys[status];
}

function reviewKey(decision: "APPROVED" | "REJECTED" | "ADJUSTMENT_REQUIRED") {
  const keys = {
    APPROVED: "reports.cash.review.approved",
    REJECTED: "reports.cash.review.rejected",
    ADJUSTMENT_REQUIRED: "reports.cash.review.adjustmentRequired",
  } as const;
  return keys[decision];
}
