import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminInvoiceCreateForm, AdminSubscriptionActions, AdditionalStallApprovalAction, BillingRequestRejectAction } from "@/components/admin-billing-actions";
import { getAdminPlanCatalog, getAdminSubscription } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";

type PageProps = { params: Promise<{ subscriptionId: string }> };

export default async function AdminSubscriptionDetailPage({ params }: PageProps) {
  const [{ subscriptionId }, { locale }] = await Promise.all([params, getRequestAppLocale()]);
  const [subscription, catalog] = await Promise.all([getAdminSubscription(subscriptionId), getAdminPlanCatalog()]);
  if (!subscription) notFound();
  const m = createAdminTranslator(locale);
  const planOptions = catalog.versions.filter((version) => (version.isPublic || version.id === subscription.planVersionId) && !version.requiresQuote && version.billingInterval !== "TRIAL" && version.pricingMode === "FIXED").map((version) => ({ id: version.id, label: `${version.displayName} v${version.version}`, monthlyPrice: version.basePrice, annualPrice: version.annualPrice, currency: version.currency }));
  const orderPackages = catalog.addOns.filter((item) => item.code.startsWith(`ORDER_PACKAGE_${subscription.plan.code}_`) && item.availabilityStatus === "ENABLED").map((item) => ({ code: item.code, name: `${item.displayName} ${formatAppCurrency(locale, item.unitPrice, item.currency)}` }));
  const pendingRequests = subscription.billingChangeRequests.filter((request) => request.status === "PENDING");
  const pendingPaygRequest = pendingRequests.find((request) => request.requestType === "PLAN_CHANGE" && request.requestedPlanVersion?.pricingMode === "USAGE_PER_STALL_CAPPED");
  const flags = new Map(catalog.featureFlags.map((flag) => [flag.code, flag.isEnabled]));
  const paygMigrationEnabled = Boolean(
    flags.get("PAYG_BILLING_ENABLED")
    && (
      (subscription.plan.code === "TRIAL" && flags.get("PAYG_NEW_MERCHANTS_ENABLED"))
      || (["LITE", "STANDARD", "PRO"].includes(subscription.plan.code) && flags.get("PAYG_LEGACY_MIGRATION_ENABLED"))
    ),
  );
  const paygCloseEnabled = Boolean(
    flags.get("PAYG_BILLING_ENABLED")
    && flags.get("PAYG_REFUND_CREDITS_ENABLED")
    && !flags.get("OPEN_BETA_FREE_ACCESS_ENABLED"),
  );
  const currentBillingPeriod = subscription.billingPeriodStart.toISOString().slice(0, 10);
  const paygUsage = subscription.organization.billingStallUsageSummaries.filter(
    (summary) => summary.billingPeriod.toISOString().slice(0, 10) === currentBillingPeriod,
  );

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <Link href="/admin/subscriptions" className="text-sm font-semibold text-teal-800">{m("Back to subscriptions")}</Link>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{subscription.organization.businessName}</p><div className="mt-1 flex flex-wrap justify-between gap-3"><div><h1 className="text-3xl font-semibold">{subscription.planVersion.displayName} v{formatAppNumber(locale, subscription.planVersion.version)}</h1><p className="mt-2 text-sm text-stone-600">{m("{start} to {end}", { start: formatAppDate(locale, subscription.billingPeriodStart), end: formatAppDate(locale, subscription.billingPeriodEnd) })}</p></div><strong>{getAdminCodeLabel(locale, subscription.status)}</strong></div></header>
      {subscription.plan.code === "PAYG" || paygUsage.length > 0 ? <section className="border-b border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Current PAYG usage by stall")}</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{paygUsage.map((summary) => <article key={summary.id} className="rounded-md border border-stone-200 p-4"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{summary.stall.name}</h3><strong>{formatAppCurrency(locale, summary.finalCharge, "TWD")}</strong></div><dl className="mt-3 space-y-2 text-sm"><Row label={m("Gross completed orders")} value={formatAppNumber(locale, summary.grossCompletedOrderCount)} /><Row label={m("Full refund credits")} value={formatAppNumber(locale, summary.fullRefundCreditCount)} /><Row label={m("Net billable orders")} value={formatAppNumber(locale, summary.netBillableOrderCount)} /><Row label={m("Per-stall monthly cap")} value={formatAppCurrency(locale, summary.capAmount, "TWD")} /><Row label={m("Cap savings")} value={formatAppCurrency(locale, summary.capSavings, "TWD")} /></dl><progress value={summary.finalCharge} max={summary.capAmount} className="mt-3 h-2 w-full accent-teal-700" /></article>)}{paygUsage.length === 0 ? <p className="text-sm text-stone-500">{m("No PAYG usage has been reconciled for this period.")}</p> : null}</div></section> : null}
      <section className="py-6"><h2 className="text-xl font-semibold">{m("Manual subscription actions")}</h2><div className="mt-4"><AdminSubscriptionActions subscriptionId={subscription.id} status={subscription.status} orderPackages={orderPackages} planCode={subscription.plan.code} paygMigrationEnabled={paygMigrationEnabled} paygCloseEnabled={paygCloseEnabled} nextPaygEffectiveDate={subscription.billingPeriodEnd.toISOString().slice(0, 10)} paygRequestId={pendingPaygRequest?.id} /></div></section>
      {planOptions.length ? <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Create plan invoice / renewal")}</h2><p className="mt-2 text-sm text-stone-600">{m("Prices come from the selected plan version. The plan and period change only after payment is confirmed.")}</p><div className="mt-4"><AdminInvoiceCreateForm organizationId={subscription.organizationId} plans={planOptions} /></div></section> : null}
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Pending requests")}</h2><div className="mt-3 space-y-4">{pendingRequests.map((request) => <article key={request.id} className="rounded-md border border-stone-200 p-4"><strong>{request.requestType === "PLAN_CHANGE" ? m("Plan: {plan}", { plan: request.requestedPlanVersion?.displayName ?? m("Not specified") }) : m("{count} additional stalls", { count: formatAppNumber(locale, request.requestedQuantity ?? 0) })}</strong><p className="mt-1 text-sm text-stone-600">{request.reason}</p>{request.requestType === "ADDITIONAL_STALL" ? <AdditionalStallApprovalAction organizationId={subscription.organizationId} requestId={request.id} quantity={request.requestedQuantity ?? 1} unitPrice={subscription.planVersion.additionalStallPrice} /> : null}<BillingRequestRejectAction requestId={request.id} /></article>)}{pendingRequests.length === 0 ? <p className="text-sm text-stone-500">{m("There are no pending requests.")}</p> : null}</div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Subscription items")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{subscription.items.map((item) => <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"><span>{item.description} · {getAdminCodeLabel(locale, item.status)}</span><strong>{m("{quantity} × {price}", { quantity: formatAppNumber(locale, item.quantity), price: formatAppCurrency(locale, item.unitPrice, item.currency) })}</strong></div>)}</div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Recent invoices")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{subscription.invoices.map((invoice) => <Link key={invoice.id} href={`/admin/invoices/${invoice.id}`} className="flex justify-between gap-3 py-3 text-sm"><span>{invoice.invoiceNumber} · {getAdminCodeLabel(locale, invoice.status)}</span><strong>{m("{amount} due", { amount: formatAppCurrency(locale, invoice.amountDue, invoice.currency) })}</strong></Link>)}</div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("PAYG migration and billing audit")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{subscription.organization.auditLogs.map((audit) => <article key={audit.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]"><strong>{getAdminCodeLabel(locale, audit.action)}</strong><time className="text-stone-500">{formatAppDate(locale, audit.createdAt)}</time><p className="text-stone-600">{audit.actor?.displayName ?? m("System")} · request ID: {audit.requestId}</p></article>)}{subscription.organization.auditLogs.length === 0 ? <p className="py-4 text-sm text-stone-500">{m("No PAYG audit events.")}</p> : null}</div></section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-stone-500">{label}</dt><dd className="font-medium">{value}</dd></div>;
}
