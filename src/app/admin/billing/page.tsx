import Link from "next/link";
import { AdditionalStallApprovalAction, AdminInvoiceCreateForm, AdminPaymentReviewActions, BillingRequestRejectAction } from "@/components/admin-billing-actions";
import { getAdminBillingOverview, getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { paymentMethodLabels } from "@/lib/billing-labels";
import { formatMoney } from "@/lib/money";

export default async function AdminBillingPage() {
  const [overview, catalog] = await Promise.all([getAdminBillingOverview(), getAdminPlanCatalog()]);
  const planOptions = catalog.versions.filter((version) => version.isPublic && !version.requiresQuote && version.billingInterval !== "TRIAL");
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header><p className="text-sm font-semibold text-teal-800">Phase 1 人工計費</p><h1 className="mt-1 text-3xl font-semibold">平台帳務總覽</h1><p className="mt-2 text-sm text-stone-600">方案、帳單、付款確認與訂閱狀態均由 StallOrder 資料庫決定。</p></header>
      <section className="mt-6 grid border-y border-stone-200 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="有效訂閱" value={overview.metrics.activeSubscriptions} />
        <Metric label="試用中" value={overview.metrics.trialingSubscriptions} />
        <Metric label="逾期" value={overview.metrics.pastDueSubscriptions} />
        <Metric label="已停權" value={overview.metrics.suspendedSubscriptions} />
        <Metric label="待付款帳單" value={overview.metrics.openInvoices + overview.metrics.overdueInvoices} />
        <Metric label="已付帳單" value={overview.metrics.paidInvoices} />
        <Metric label="本月開立" value={formatMoney(overview.metrics.monthlyInvoiced)} />
        <Metric label="本月收款" value={formatMoney(overview.metrics.monthlyCollected)} />
        <Metric label="試用轉付費" value={overview.metrics.trialConversions} />
        <Metric label="待審核付款" value={overview.pendingPayments.length} />
      </section>

      <section className="py-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">方案與攤位申請</h2><Link href="/admin/subscriptions" className="text-sm font-semibold text-teal-800">查看所有訂閱</Link></div><div className="mt-4 grid gap-4 lg:grid-cols-2">
        {overview.pendingRequests.map((request) => <article key={request.id} className="rounded-md border border-stone-200 p-5"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold text-teal-800">{request.requestType === "PLAN_CHANGE" ? "方案變更" : "額外攤位"}</p><h3 className="mt-1 text-lg font-semibold">{request.organization.businessName}</h3></div><time className="text-xs text-stone-500">{request.createdAt.toISOString().slice(0, 10)}</time></div><p className="mt-3 text-sm text-stone-600">申請人：{request.requestedBy.displayName}；原因：{request.reason}</p>{request.requestType === "PLAN_CHANGE" && request.requestedPlanVersionId && request.requestedBillingInterval ? <div className="mt-4"><AdminInvoiceCreateForm organizationId={request.organizationId} plans={planOptions.filter((version) => version.id === request.requestedPlanVersionId).map(toPlanOption)} request={{ id: request.id, planVersionId: request.requestedPlanVersionId, billingInterval: request.requestedBillingInterval as "MONTHLY" | "ANNUAL" }} /></div> : <AdditionalStallApprovalAction organizationId={request.organizationId} requestId={request.id} quantity={request.requestedQuantity ?? 1} unitPrice={request.subscription.planVersion.additionalStallPrice} />}<BillingRequestRejectAction requestId={request.id} /></article>)}
        {overview.pendingRequests.length === 0 ? <p className="py-6 text-sm text-stone-500">目前沒有待審核申請。</p> : null}
      </div></section>

      <section className="border-t border-stone-200 py-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">待確認付款</h2><Link href="/admin/payments" className="text-sm font-semibold text-teal-800">查看全部付款紀錄</Link></div><div className="mt-4 grid gap-4 lg:grid-cols-2">{overview.pendingPayments.map((payment) => <article id={payment.id} key={payment.id} className="rounded-md border border-stone-200 p-5"><div className="flex justify-between gap-3"><div><h3 className="font-semibold">{payment.organization.businessName}</h3><Link href={`/admin/invoices/${payment.invoiceId}`} className="mt-1 block text-sm font-semibold text-teal-800">{payment.invoice.invoiceNumber}</Link></div><strong>{formatMoney(payment.amount, payment.currency)}</strong></div><p className="mt-2 text-sm text-stone-600">{paymentMethodLabels[payment.paymentMethod] ?? payment.paymentMethod} · {payment.recordedBy.displayName}</p><div className="mt-4"><AdminPaymentReviewActions paymentId={payment.id} /></div></article>)}{overview.pendingPayments.length === 0 ? <p className="py-6 text-sm text-stone-500">目前沒有待確認付款。</p> : null}</div></section>

      <section className="border-y border-stone-200 bg-stone-50 py-4 text-sm"><strong>電子發票整合尚未啟用</strong><p className="mt-1 text-stone-600">此頁只管理 StallOrder 帳單，不會呼叫任何外部付款或電子發票服務。</p></section>
    </main>
  );
}

function toPlanOption(version: { id: string; displayName: string; version: number; basePrice: number; annualPrice: number | null; currency: string }) { return { id: version.id, label: `${version.displayName} v${version.version}`, monthlyPrice: version.basePrice, annualPrice: version.annualPrice, currency: version.currency }; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="border-b border-stone-200 px-3 py-5"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 break-words text-xl font-semibold">{value}</div></div>; }
