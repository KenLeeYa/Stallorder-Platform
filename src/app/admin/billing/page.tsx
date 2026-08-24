import Link from "next/link";
import { Banknote, CircleAlert, CirclePause, Clock3, CreditCard, FileCheck2, ReceiptText, ShieldCheck, TrendingUp, WalletCards } from "lucide-react";
import { AdditionalStallApprovalAction, AdminInvoiceCreateForm, AdminPaymentReviewActions, BillingRequestRejectAction } from "@/components/admin-billing-actions";
import { AdminBillingFeatureFlagControls } from "@/components/admin-billing-feature-flag-controls";
import { AdminModuleVisibilityControls } from "@/components/admin-module-visibility-controls";
import { getAdminBillingOverview, getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";
import { getAdminModuleVisibility } from "@/server/admin/admin-module-visibility";
import { getPaygCloseDashboard } from "@/server/billing/payg-close-dashboard";

export default async function AdminBillingPage() {
  const [{ locale }, overview, catalog, moduleVisibility, paygClose] = await Promise.all([getRequestAppLocale(), getAdminBillingOverview(), getAdminPlanCatalog(), getAdminModuleVisibility(), getPaygCloseDashboard()]);
  const m = createAdminTranslator(locale);
  const planOptions = catalog.versions.filter((version) => !version.requiresQuote && version.billingInterval !== "TRIAL" && version.pricingMode === "FIXED");

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header><p className="text-sm font-semibold text-teal-800">{m("Phase 1 manual billing")}</p><h1 className="mt-1 text-3xl font-semibold">{m("Platform billing overview")}</h1><p className="mt-2 text-sm text-stone-600">{m("Plans, invoices, payment confirmation, and subscription status are determined by the StallOrder database.")}</p></header>
      <dl data-testid="admin-billing-dashboard" className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200 sm:grid-cols-3 lg:grid-cols-5">
        <Metric icon={ShieldCheck} label={m("Active subscriptions")} value={formatAppNumber(locale, overview.metrics.activeSubscriptions)} />
        <Metric icon={Clock3} label={m("Trialing")} value={formatAppNumber(locale, overview.metrics.trialingSubscriptions)} />
        <Metric icon={CircleAlert} label={m("Past due")} value={formatAppNumber(locale, overview.metrics.pastDueSubscriptions)} />
        <Metric icon={CirclePause} label={m("Suspended")} value={formatAppNumber(locale, overview.metrics.suspendedSubscriptions)} />
        <Metric icon={ReceiptText} label={m("Open invoices")} value={formatAppNumber(locale, overview.metrics.openInvoices + overview.metrics.overdueInvoices)} />
        <Metric icon={FileCheck2} label={m("Paid invoices")} value={formatAppNumber(locale, overview.metrics.paidInvoices)} />
        <Metric icon={CreditCard} label={m("Invoiced this month")} value={formatAppCurrency(locale, overview.metrics.monthlyInvoiced)} />
        {moduleVisibility.payments ? <Metric icon={Banknote} label={m("Collected this month")} value={formatAppCurrency(locale, overview.metrics.monthlyCollected)} /> : null}
        <Metric icon={TrendingUp} label={m("Trial conversions")} value={formatAppNumber(locale, overview.metrics.trialConversions)} />
        {moduleVisibility.payments ? <Metric icon={WalletCards} label={m("Payments pending review")} value={formatAppNumber(locale, overview.pendingPayments.length)} /> : null}
      </dl>
      <AdminBillingFeatureFlagControls flags={catalog.featureFlags} />
      <AdminModuleVisibilityControls initialVisibility={moduleVisibility} />
      <section className="border-t border-stone-200 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-xl font-semibold">{m("PAYG automatic close status")}</h2><p className="mt-1 text-sm text-stone-600">{m("This dashboard is read-only. Charging and automatic close remain controlled by separate audited feature flags.")}</p></div>
          <span className={`rounded-md px-3 py-1 text-sm font-semibold ${paygClose.alert ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{m(paygClose.alert ? "Attention required" : "Normal")}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200 sm:grid-cols-3 lg:grid-cols-5">
          <PaygStatus label={m("Automatic close")} value={m(paygClose.automaticEnabled ? "Enabled" : "Disabled")} />
          <PaygStatus label={m("Last scheduler run")} value={paygClose.latestRunAt ? formatAppDate(locale, paygClose.latestRunAt) : "—"} />
          <PaygStatus label={m("Target period")} value={paygClose.targetPeriod ? formatAppDate(locale, paygClose.targetPeriod) : "—"} />
          <PaygStatus label={m("Eligible")} value={formatAppNumber(locale, paygClose.eligible)} />
          <PaygStatus label={m("Succeeded")} value={formatAppNumber(locale, paygClose.succeeded)} />
          <PaygStatus label={m("Skipped")} value={formatAppNumber(locale, paygClose.skipped)} />
          <PaygStatus label={m("Failed")} value={formatAppNumber(locale, paygClose.failed)} />
          <PaygStatus label={m("Retry count")} value={formatAppNumber(locale, paygClose.retryCount)} />
          <PaygStatus label={m("Unclosed periods")} value={formatAppNumber(locale, paygClose.unclosedPeriods)} />
          <PaygStatus label={m("Scheduler alert")} value={m(paygClose.stale ? "Stale" : "Normal")} />
        </dl>
      </section>
      <section className="py-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{m("Plan and stall requests")}</h2><Link href="/admin/subscriptions" className="text-sm font-semibold text-teal-800">{m("View all subscriptions")}</Link></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {overview.pendingRequests.map((request) => (
            <article key={request.id} className="rounded-md border border-stone-200 p-5">
              <div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold text-teal-800">{m(request.requestType === "PLAN_CHANGE" ? "Plan change" : "Additional stalls")}</p><h3 className="mt-1 text-lg font-semibold">{request.organization.businessName}</h3></div><time className="text-xs text-stone-500">{formatAppDate(locale, request.createdAt)}</time></div>
              <p className="mt-3 text-sm text-stone-600">{m("Applicant: {applicant}; reason: {reason}", { applicant: request.requestedBy.displayName, reason: request.reason })}</p>
              {request.requestType === "PLAN_CHANGE" ? (
                request.requestedPlanVersion?.plan.code === "PAYG" ? (
                  <Link href={`/admin/subscriptions/${request.subscriptionId}#payg-migration`} className="mt-4 inline-flex min-h-11 items-center rounded-md bg-amber-900 px-4 text-sm font-semibold text-white">{m("Review PAYG migration")}</Link>
                ) : request.requestedPlanVersionId && request.requestedBillingInterval ? (
                  <div className="mt-4"><AdminInvoiceCreateForm organizationId={request.organizationId} plans={planOptions.filter((version) => version.id === request.requestedPlanVersionId).map(toPlanOption)} request={{ id: request.id, planVersionId: request.requestedPlanVersionId, billingInterval: request.requestedBillingInterval as "MONTHLY" | "ANNUAL" }} /></div>
                ) : <p className="mt-4 text-sm text-amber-800">{m("This request requires manual review.")}</p>
              ) : <AdditionalStallApprovalAction organizationId={request.organizationId} requestId={request.id} quantity={request.requestedQuantity ?? 1} unitPrice={request.subscription.planVersion.additionalStallPrice} />}
              <BillingRequestRejectAction requestId={request.id} />
            </article>
          ))}
          {overview.pendingRequests.length === 0 ? <p className="py-6 text-sm text-stone-500">{m("There are no requests pending review.")}</p> : null}
        </div>
      </section>
      {moduleVisibility.payments ? <section className="border-t border-stone-200 py-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{m("Payments pending confirmation")}</h2><Link href="/admin/payments" className="text-sm font-semibold text-teal-800">{m("View all payment records")}</Link></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {overview.pendingPayments.map((payment) => <article id={payment.id} key={payment.id} className="rounded-md border border-stone-200 p-5"><div className="flex justify-between gap-3"><div><h3 className="font-semibold">{payment.organization.businessName}</h3><Link href={`/admin/invoices/${payment.invoiceId}`} className="mt-1 block text-sm font-semibold text-teal-800">{payment.invoice.invoiceNumber}</Link></div><strong>{formatAppCurrency(locale, payment.amount, payment.currency)}</strong></div><p className="mt-2 text-sm text-stone-600">{getAdminCodeLabel(locale, payment.paymentMethod)} · {payment.recordedBy.displayName}</p><div className="mt-4"><AdminPaymentReviewActions paymentId={payment.id} /></div></article>)}
          {overview.pendingPayments.length === 0 ? <p className="py-6 text-sm text-stone-500">{m("There are no payments pending confirmation.")}</p> : null}
        </div>
      </section> : null}
      {moduleVisibility.payments ? <section className="border-y border-stone-200 bg-stone-50 py-4 text-sm"><strong>{m("E-invoice integration is not enabled")}</strong><p className="mt-1 text-stone-600">{m("This page manages only StallOrder invoices and never calls external payment or e-invoice services.")}</p></section> : null}
    </main>
  );
}

function toPlanOption(version: { id: string; displayName: string; version: number; basePrice: number; annualPrice: number | null; currency: string }) {
  return { id: version.id, label: `${version.displayName} v${version.version}`, monthlyPrice: version.basePrice, annualPrice: version.annualPrice, currency: version.currency };
}

function Metric({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string | number }) {
  return <div className="min-w-0 bg-white p-3 sm:px-4 sm:py-5"><dt className="flex min-w-0 items-center gap-2 text-xs text-stone-500"><Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-teal-700" /><span className="min-w-0 break-words">{label}</span></dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{value}</dd></div>;
}

function PaygStatus({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-white p-3"><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>;
}
