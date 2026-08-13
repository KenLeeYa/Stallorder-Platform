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
  const planOptions = catalog.versions.filter((version) => version.isPublic && !version.requiresQuote && version.billingInterval !== "TRIAL").map((version) => ({ id: version.id, label: `${version.displayName} v${version.version}`, monthlyPrice: version.basePrice, annualPrice: version.annualPrice, currency: version.currency }));
  const orderPackages = catalog.addOns.filter((item) => item.code.startsWith(`ORDER_PACKAGE_${subscription.plan.code}_`) && item.availabilityStatus === "ENABLED").map((item) => ({ code: item.code, name: `${item.displayName} ${formatAppCurrency(locale, item.unitPrice, item.currency)}` }));
  const pendingRequests = subscription.billingChangeRequests.filter((request) => request.status === "PENDING");

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <Link href="/admin/subscriptions" className="text-sm font-semibold text-teal-800">{m("Back to subscriptions")}</Link>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{subscription.organization.businessName}</p><div className="mt-1 flex flex-wrap justify-between gap-3"><div><h1 className="text-3xl font-semibold">{subscription.planVersion.displayName} v{formatAppNumber(locale, subscription.planVersion.version)}</h1><p className="mt-2 text-sm text-stone-600">{m("{start} to {end}", { start: formatAppDate(locale, subscription.billingPeriodStart), end: formatAppDate(locale, subscription.billingPeriodEnd) })}</p></div><strong>{getAdminCodeLabel(locale, subscription.status)}</strong></div></header>
      <section className="py-6"><h2 className="text-xl font-semibold">{m("Manual subscription actions")}</h2><div className="mt-4"><AdminSubscriptionActions subscriptionId={subscription.id} status={subscription.status} orderPackages={orderPackages} /></div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Create plan invoice / renewal")}</h2><p className="mt-2 text-sm text-stone-600">{m("Prices come from the selected plan version. The plan and period change only after payment is confirmed.")}</p><div className="mt-4"><AdminInvoiceCreateForm organizationId={subscription.organizationId} plans={planOptions} /></div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Pending requests")}</h2><div className="mt-3 space-y-4">{pendingRequests.map((request) => <article key={request.id} className="rounded-md border border-stone-200 p-4"><strong>{request.requestType === "PLAN_CHANGE" ? m("Plan: {plan}", { plan: request.requestedPlanVersion?.displayName ?? m("Not specified") }) : m("{count} additional stalls", { count: formatAppNumber(locale, request.requestedQuantity ?? 0) })}</strong><p className="mt-1 text-sm text-stone-600">{request.reason}</p>{request.requestType === "ADDITIONAL_STALL" ? <AdditionalStallApprovalAction organizationId={subscription.organizationId} requestId={request.id} quantity={request.requestedQuantity ?? 1} unitPrice={subscription.planVersion.additionalStallPrice} /> : null}<BillingRequestRejectAction requestId={request.id} /></article>)}{pendingRequests.length === 0 ? <p className="text-sm text-stone-500">{m("There are no pending requests.")}</p> : null}</div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Subscription items")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{subscription.items.map((item) => <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"><span>{item.description} · {getAdminCodeLabel(locale, item.status)}</span><strong>{m("{quantity} × {price}", { quantity: formatAppNumber(locale, item.quantity), price: formatAppCurrency(locale, item.unitPrice, item.currency) })}</strong></div>)}</div></section>
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Recent invoices")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{subscription.invoices.map((invoice) => <Link key={invoice.id} href={`/admin/invoices/${invoice.id}`} className="flex justify-between gap-3 py-3 text-sm"><span>{invoice.invoiceNumber} · {getAdminCodeLabel(locale, invoice.status)}</span><strong>{m("{amount} due", { amount: formatAppCurrency(locale, invoice.amountDue, invoice.currency) })}</strong></Link>)}</div></section>
    </main>
  );
}
