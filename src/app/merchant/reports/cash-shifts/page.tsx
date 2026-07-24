import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { ReportFilters, ReportNavigation } from "@/components/report-navigation";
import { formatTaipeiDateTime } from "@/lib/date-time";
import { formatMoney } from "@/lib/money";
import { getCashShiftReport } from "@/lib/report-data";
import { requireReportScope } from "@/lib/report-scope";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = {
  searchParams: Promise<{
    organizationId?: string;
    stallId?: string | string[];
    dateFrom?: string;
    dateTo?: string;
  }>;
};

export default async function CashShiftReportPage({ searchParams }: PageProps) {
  const scope = await requireReportScope(await searchParams);
  const featureAccess = await getFeatureAccess(scope.workspace.id, "CASH_SHIFT");
  if (!featureAccess.allowed) {
    return <FeatureUpgradeNotice
      title="現金交班報表目前無法使用"
      message={featureAccess.message}
      billingHref={`/merchant/subscription?organizationId=${scope.workspace.id}`}
    />;
  }
  const rows = await getCashShiftReport(
    scope.workspace.id,
    scope.stalls.map((stall) => stall.id),
    scope.dateFrom,
    scope.dateTo,
  );
  const summary = rows.reduce((total, row) => ({
    cashSales: total.cashSales + row.cashSales,
    cashRefunds: total.cashRefunds + row.cashRefunds,
    expected: total.expected + row.expectedAmount,
    actual: total.actual + (row.actualAmount ?? 0),
    difference: total.difference + (row.differenceAmount ?? 0),
    reviewRequired: total.reviewRequired + (row.status === "CLOSING" || row.status === "REVIEW_REQUIRED" ? 1 : 0),
  }), { cashSales: 0, cashRefunds: 0, expected: 0, actual: 0, difference: 0, reviewRequired: 0 });
  const currency = scope.workspace.defaultCurrency;

  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
    <header><p className="text-sm font-semibold text-teal-800">跨攤位報表</p><h1 className="mt-1 text-3xl font-semibold">現金交班與短溢收</h1><p className="mt-2 text-sm text-stone-600">檢視開班、現金收支、系統應有、實際盤點及複核狀態。</p></header>
    <ReportNavigation organizationId={scope.workspace.id} active="cash-shifts" />
    <ReportFilters organizationId={scope.workspace.id} stalls={scope.availableStalls} selectedStallIds={scope.stalls.map((stall) => stall.id)} dateFrom={scope.dateFrom} dateTo={scope.dateTo} />
    <section className="grid border-b border-stone-200 sm:grid-cols-3 lg:grid-cols-6">
      <SummaryMetric label="班次" value={`${rows.length} 班`} />
      <SummaryMetric label="現金銷售" value={formatMoney(summary.cashSales, currency)} />
      <SummaryMetric label="現金退款" value={formatMoney(summary.cashRefunds, currency)} />
      <SummaryMetric label="系統應有" value={formatMoney(summary.expected, currency)} />
      <SummaryMetric label="短溢收合計" value={formatSignedMoney(summary.difference, currency)} alert={summary.difference !== 0} />
      <SummaryMetric label="待複核" value={`${summary.reviewRequired} 班`} alert={summary.reviewRequired > 0} />
    </section>
    <section className="py-7">
      <h2 className="text-xl font-semibold">班次明細</h2>
      <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
        {rows.map((row) => <article key={row.id} className="py-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{row.stallName}</strong><p className="mt-1 text-xs text-stone-500">{row.openedByName} · {formatTaipeiDateTime(row.openedAt)}{row.closedAt ? ` 至 ${formatTaipeiDateTime(row.closedAt)}` : ""}</p></div><span className="rounded bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{statusLabel(row.status)}</span></div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4 lg:grid-cols-8">
            <Amount label="開班" value={row.openingAmount} currency={currency} />
            <Amount label="銷售" value={row.cashSales} currency={currency} />
            <Amount label="退款" value={-row.cashRefunds} currency={currency} signed />
            <Amount label="收入／支出" value={row.cashIn - row.cashOut} currency={currency} signed />
            <Amount label="更正" value={row.corrections} currency={currency} signed />
            <Amount label="應有" value={row.expectedAmount} currency={currency} />
            <Amount label="盤點" value={row.actualAmount} currency={currency} />
            <Amount label="短溢收" value={row.differenceAmount} currency={currency} signed alert={(row.differenceAmount ?? 0) !== 0} />
          </dl>
          {row.latestReviewDecision ? <p className="mt-3 text-xs text-stone-600">最近複核：{reviewLabel(row.latestReviewDecision)}{row.latestReviewerName ? ` · ${row.latestReviewerName}` : ""}</p> : null}
        </article>)}
      </div>
      {rows.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">所選區間尚無現金班次。</p> : null}
    </section>
  </main>;
}

function SummaryMetric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className="border-t border-stone-200 py-5 sm:px-4 lg:border-t-0"><div className="text-sm text-stone-500">{label}</div><div className={`mt-1 text-xl font-semibold ${alert ? "text-amber-800" : "text-stone-950"}`}>{value}</div></div>;
}

function Amount({ label, value, currency, signed = false, alert = false }: { label: string; value: number | null; currency: string; signed?: boolean; alert?: boolean }) {
  return <div><dt className="text-xs text-stone-500">{label}</dt><dd className={`mt-1 font-semibold ${alert ? "text-amber-800" : "text-stone-900"}`}>{value === null ? "-" : signed ? formatSignedMoney(value, currency) : formatMoney(value, currency)}</dd></div>;
}

function formatSignedMoney(amount: number, currency: string) {
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${formatMoney(Math.abs(amount), currency)}`;
}

function statusLabel(status: "OPEN" | "CLOSING" | "REVIEW_REQUIRED" | "CLOSED") {
  return { OPEN: "進行中", CLOSING: "等待複核", REVIEW_REQUIRED: "需要更正", CLOSED: "已結班" }[status];
}

function reviewLabel(decision: "APPROVED" | "REJECTED" | "ADJUSTMENT_REQUIRED") {
  return { APPROVED: "核准", REJECTED: "退回", ADJUSTMENT_REQUIRED: "要求更正" }[decision];
}
