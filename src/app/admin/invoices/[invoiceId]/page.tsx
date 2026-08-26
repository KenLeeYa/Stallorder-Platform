import { ContextualBackButton } from "@/components/contextual-back-button";
import { notFound } from "next/navigation";
import { AdminInvoiceLineForm, AdminInvoiceVoidAction, AdminPaymentReviewActions } from "@/components/admin-billing-actions";
import { ManualPaymentForm } from "@/components/manual-payment-form";
import { getAdminInvoice, getAdminPlanCatalog } from "@/lib/admin-billing-data";
import type { AppLocale } from "@/lib/app-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";

type PageProps = { params: Promise<{ invoiceId: string }> };

export default async function AdminInvoiceDetailPage({ params }: PageProps) {
  const [{ invoiceId }, { locale }] = await Promise.all([params, getRequestAppLocale()]);
  const [invoice, catalog] = await Promise.all([getAdminInvoice(invoiceId), getAdminPlanCatalog()]);
  if (!invoice) notFound();
  const m = createAdminTranslator(locale);
  const addOns = catalog.addOns.filter((item) => item.isActive && item.availabilityStatus !== "COMING_SOON" && !item.code.startsWith("ORDER_PACKAGE_") && !item.code.startsWith("ADDITIONAL_STALL_") && item.code !== "CUSTOM_SERVICE").map((item) => ({ code: item.code, name: item.displayName, price: item.unitPrice, currency: item.currency }));
  const editable = ["DRAFT", "OPEN", "OVERDUE"].includes(invoice.status);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <ContextualBackButton fallbackHref="/admin/invoices" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-800">{m("Back to invoices")}</ContextualBackButton>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{invoice.organization.businessName}</p><div className="mt-1 flex flex-wrap justify-between gap-3"><div><h1 className="text-3xl font-semibold">{invoice.invoiceNumber}</h1><p className="mt-2 text-sm text-stone-600">{invoice.subscription.planVersion.displayName} · {m("Due {date}", { date: formatAppDate(locale, invoice.dueAt) })}</p></div><strong>{getAdminCodeLabel(locale, invoice.status)}</strong></div></header>
      <section className="py-6">
        <h2 className="text-xl font-semibold">{m("Invoice details")}</h2>
        <div data-testid="admin-invoice-detail-mobile-list" className="mt-3 grid gap-3 md:hidden">
          {invoice.lineItems.map((line) => (
            <article key={line.id} className="min-w-0 rounded-md border border-stone-200 bg-white p-4">
              <div className="min-w-0 break-words font-semibold">{line.description}</div>
              <p className="mt-1 text-sm text-stone-600">{getAdminCodeLabel(locale, line.itemType)}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <Amount locale={locale} label={m("Quantity")} value={line.quantity} currency="" />
                <Amount locale={locale} label={m("Unit price")} value={line.unitPrice} currency={invoice.currency} />
                <Amount locale={locale} label={m("Subtotal")} value={line.subtotal} currency={invoice.currency} strong />
              </dl>
            </article>
          ))}
        </div>
        <div data-testid="admin-invoice-detail-desktop-table" className="mt-3 hidden overflow-x-auto border-y border-stone-200 md:block">
          <table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-stone-50"><tr><th className="px-3 py-3">{m("Item")}</th><th className="px-3 py-3">{m("Type")}</th><th className="px-3 py-3 text-right">{m("Quantity")}</th><th className="px-3 py-3 text-right">{m("Unit price")}</th><th className="px-3 py-3 text-right">{m("Subtotal")}</th></tr></thead><tbody className="divide-y divide-stone-200">{invoice.lineItems.map((line) => <tr key={line.id}><td className="px-3 py-4 font-medium">{line.description}</td><td className="px-3 py-4 text-stone-600">{getAdminCodeLabel(locale, line.itemType)}</td><td className="px-3 py-4 text-right">{formatAppNumber(locale, line.quantity)}</td><td className="px-3 py-4 text-right">{formatAppCurrency(locale, line.unitPrice, invoice.currency)}</td><td className="px-3 py-4 text-right">{formatAppCurrency(locale, line.subtotal, invoice.currency)}</td></tr>)}</tbody></table>
        </div>
        <dl className="ml-auto mt-4 max-w-sm space-y-2 text-sm"><Amount locale={locale} label={m("Subtotal")} value={invoice.subtotal} currency={invoice.currency} /><Amount locale={locale} label={m("Credits / discounts")} value={invoice.discountAmount} currency={invoice.currency} /><Amount locale={locale} label={m("Total")} value={invoice.totalAmount} currency={invoice.currency} strong /><Amount locale={locale} label={m("Paid")} value={invoice.amountPaid} currency={invoice.currency} /><Amount locale={locale} label={m("Due")} value={invoice.amountDue} currency={invoice.currency} strong /></dl>
      </section>
      {editable ? <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Add a manual invoice item")}</h2><p className="mt-2 text-sm text-stone-600">{m("Add-ons use catalog prices. Custom services and credits require an administrator-entered reason.")}</p><div className="mt-4"><AdminInvoiceLineForm invoiceId={invoice.id} addOns={addOns} /></div></section> : null}
      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("Payment records")}</h2><div className="mt-3 space-y-4">{invoice.manualPayments.map((payment) => <article key={payment.id} className="rounded-md border border-stone-200 p-4"><div className="flex flex-wrap justify-between gap-3"><span><strong>{getAdminCodeLabel(locale, payment.paymentMethod)}</strong> · {getAdminCodeLabel(locale, payment.verificationStatus)}</span><strong>{formatAppCurrency(locale, payment.amount, payment.currency)}</strong></div><p className="mt-2 text-sm text-stone-600">{payment.verifiedBy ? m("Recorded: {recordedBy}; reviewed: {reviewedBy}", { recordedBy: payment.recordedBy.displayName, reviewedBy: payment.verifiedBy.displayName }) : m("Recorded: {recordedBy}", { recordedBy: payment.recordedBy.displayName })}</p>{payment.verificationStatus === "PENDING_VERIFICATION" ? <div className="mt-4"><AdminPaymentReviewActions paymentId={payment.id} /></div> : null}</article>)}{invoice.manualPayments.length === 0 ? <p className="text-sm text-stone-500">{m("There are no payment records yet.")}</p> : null}</div></section>
      {editable && invoice.amountDue > 0 ? <ManualPaymentForm organizationId={invoice.organizationId} invoiceId={invoice.id} amountDue={invoice.amountDue} currency={invoice.currency} /> : null}
      {editable && invoice.amountPaid === 0 ? <section className="mt-6 border-t border-stone-200 pt-6"><h2 className="text-xl font-semibold">{m("Void invoice")}</h2><div className="mt-4"><AdminInvoiceVoidAction invoiceId={invoice.id} /></div></section> : null}
      <section className="mt-6 border-y border-stone-200 bg-stone-50 py-4 text-sm"><strong>{m("E-invoice integration is not enabled")}</strong><p className="mt-1 text-stone-600">{m("No e-invoice action is available and no data is sent to external services.")}</p></section>
    </main>
  );
}

function Amount({ locale, label, value, currency, strong = false }: { locale: AppLocale; label: string; value: number; currency: string; strong?: boolean }) {
  return <div className="flex justify-between gap-3"><dt className={strong ? "font-semibold" : "text-stone-600"}>{label}</dt><dd className={strong ? "font-semibold" : ""}>{currency ? formatAppCurrency(locale, value, currency) : formatAppNumber(locale, value)}</dd></div>;
}
