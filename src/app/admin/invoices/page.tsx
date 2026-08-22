import Link from "next/link";
import { getAdminInvoices } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDate } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";

export default async function AdminInvoicesPage() {
  const [{ locale }, invoices] = await Promise.all([getRequestAppLocale(), getAdminInvoices()]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header><h1 className="text-3xl font-semibold">{m("Invoice management")}</h1><p className="mt-2 text-sm text-stone-600">{m("All amounts are recalculated from server-side line items. The browser cannot set the final total.")}</p></header>
      <div data-testid="admin-invoices-mobile-list" className="mt-6 grid gap-3 md:hidden">
        {invoices.map((invoice) => (
          <article key={invoice.id} className="min-w-0 rounded-md border border-stone-200 bg-white p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all text-xs font-semibold text-teal-800">{invoice.invoiceNumber}</p>
                <h2 className="mt-1 break-words text-lg font-semibold">{invoice.organization.businessName}</h2>
              </div>
              <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{getAdminCodeLabel(locale, invoice.status)}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <MobileDetail label={m("Due date")} value={formatAppDate(locale, invoice.dueAt)} />
              <MobileDetail label={m("Total")} value={formatAppCurrency(locale, invoice.totalAmount, invoice.currency)} />
              <MobileDetail label={m("Due")} value={formatAppCurrency(locale, invoice.amountDue, invoice.currency)} />
            </dl>
            <Link href={`/admin/invoices/${invoice.id}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-800">{m("Manage")}</Link>
          </article>
        ))}
      </div>
      <div data-testid="admin-invoices-desktop-table" className="mt-6 hidden overflow-x-auto border-y border-stone-200 md:block">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-stone-50 text-stone-600"><tr><th className="px-3 py-3">{m("Invoice")}</th><th className="px-3 py-3">{m("Merchant")}</th><th className="px-3 py-3">{m("Status")}</th><th className="px-3 py-3">{m("Due date")}</th><th className="px-3 py-3 text-right">{m("Total")}</th><th className="px-3 py-3 text-right">{m("Due")}</th><th className="px-3 py-3 text-right">{m("Manage")}</th></tr></thead>
          <tbody className="divide-y divide-stone-200">
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-3 py-4 font-semibold">{invoice.invoiceNumber}</td><td className="px-3 py-4">{invoice.organization.businessName}</td><td className="px-3 py-4">{getAdminCodeLabel(locale, invoice.status)}</td><td className="px-3 py-4">{formatAppDate(locale, invoice.dueAt)}</td><td className="px-3 py-4 text-right">{formatAppCurrency(locale, invoice.totalAmount, invoice.currency)}</td><td className="px-3 py-4 text-right">{formatAppCurrency(locale, invoice.amountDue, invoice.currency)}</td><td className="px-3 py-4 text-right"><Link href={`/admin/invoices/${invoice.id}`} className="inline-flex min-h-11 items-center font-semibold text-teal-800">{m("Manage")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function MobileDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>;
}
