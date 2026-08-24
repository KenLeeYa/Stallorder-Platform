import Link from "next/link";
import { AdminPaymentReviewActions } from "@/components/admin-billing-actions";
import { getAdminPayments } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppCurrency, formatAppDateTime } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";
import { requireAdminModuleVisible } from "@/server/admin/admin-module-visibility";

export default async function AdminPaymentsPage() {
  await requireAdminModuleVisible("payments");
  const [{ locale }, payments] = await Promise.all([getRequestAppLocale(), getAdminPayments()]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <header><h1 className="text-3xl font-semibold">{m("Manual payment review")}</h1><p className="mt-2 text-sm text-stone-600">{m("Review bank transfer, cash, or manual LINE Pay records. A browser return page is not proof of payment.")}</p></header>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {payments.map((payment) => (
          <article id={payment.id} key={payment.id} className="rounded-md border border-stone-200 p-5">
            <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">{payment.organization.businessName}</h2><Link href={`/admin/invoices/${payment.invoiceId}`} className="mt-1 block text-sm font-semibold text-teal-800">{payment.invoice.invoiceNumber}</Link></div><strong>{formatAppCurrency(locale, payment.amount, payment.currency)}</strong></div>
            <dl className="mt-3 space-y-1 text-sm text-stone-600">
              <Row label={m("Payment method")} value={getAdminCodeLabel(locale, payment.paymentMethod)} />
              <Row label={m("Status")} value={getAdminCodeLabel(locale, payment.verificationStatus)} />
              <Row label={m("Recorded by")} value={payment.recordedBy.displayName} />
              <Row label={m("Payment time")} value={formatAppDateTime(locale, payment.receivedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })} />
            </dl>
            {payment.verificationStatus === "PENDING_VERIFICATION" ? <div className="mt-4"><AdminPaymentReviewActions paymentId={payment.id} /></div> : null}
          </article>
        ))}
        {payments.length === 0 ? <p className="text-sm text-stone-500">{m("There are no payment records.")}</p> : null}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt>{label}</dt><dd>{value}</dd></div>;
}
