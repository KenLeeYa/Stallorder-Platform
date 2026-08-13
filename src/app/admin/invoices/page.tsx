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
      <div className="mt-6 overflow-x-auto border-y border-stone-200">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-stone-50 text-stone-600"><tr><th className="px-3 py-3">{m("Invoice")}</th><th className="px-3 py-3">{m("Merchant")}</th><th className="px-3 py-3">{m("Status")}</th><th className="px-3 py-3">{m("Due date")}</th><th className="px-3 py-3 text-right">{m("Total")}</th><th className="px-3 py-3 text-right">{m("Due")}</th><th className="px-3 py-3 text-right">{m("Manage")}</th></tr></thead>
          <tbody className="divide-y divide-stone-200">
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-3 py-4 font-semibold">{invoice.invoiceNumber}</td><td className="px-3 py-4">{invoice.organization.businessName}</td><td className="px-3 py-4">{getAdminCodeLabel(locale, invoice.status)}</td><td className="px-3 py-4">{formatAppDate(locale, invoice.dueAt)}</td><td className="px-3 py-4 text-right">{formatAppCurrency(locale, invoice.totalAmount, invoice.currency)}</td><td className="px-3 py-4 text-right">{formatAppCurrency(locale, invoice.amountDue, invoice.currency)}</td><td className="px-3 py-4 text-right"><Link href={`/admin/invoices/${invoice.id}`} className="font-semibold text-teal-800">{m("Manage")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
