import { ContextualBackButton } from "@/components/contextual-back-button";
import { notFound } from "next/navigation";
import { ManualPaymentForm } from "@/components/manual-payment-form";
import { getInvoiceForMerchant } from "@/lib/billing-portal-data";
import { invoiceStatusLabels, paymentMethodLabels, paymentStatusLabels } from "@/lib/billing-labels";
import { requireBillingWorkspace } from "@/lib/billing-page";
import { formatAppCurrency, formatAppDate, formatAppDateTime, formatAppNumber } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";

type PageProps = {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ organizationId?: string }>;
};

export default async function MerchantInvoiceDetailPage({ params, searchParams }: PageProps) {
  const { locale, m, label } = await getRequestMerchantMessages();
  const [{ invoiceId }, { organizationId }] = await Promise.all([params, searchParams]);
  const { workspace, canManage, canViewFinancials } = await requireBillingWorkspace(organizationId);
  if (!canViewFinancials) notFound();
  const invoice = await getInvoiceForMerchant(workspace.id, invoiceId);
  if (!invoice) notFound();

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      <ContextualBackButton fallbackHref={`/merchant/billing/invoices?organizationId=${workspace.id}`}>{m("返回帳單列表")}</ContextualBackButton>
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-3xl font-semibold">{invoice.invoiceNumber}</h1><p className="mt-2 text-sm text-stone-600">{m("{start} 至 {end}", { start: formatAppDate(locale, invoice.billingPeriodStart), end: formatAppDate(locale, invoice.billingPeriodEnd) })}</p></div>
          <strong className="text-lg">{label(invoiceStatusLabels[invoice.status] ?? invoice.status)}</strong>
        </div>
      </header>

      <section className="py-6">
        <h2 className="text-xl font-semibold">{m("帳單明細")}</h2>
        <div className="mt-3 overflow-x-auto border-y border-stone-200">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-stone-50 text-stone-600"><tr><th className="px-3 py-3">{m("項目")}</th><th className="px-3 py-3 text-right">{m("數量")}</th><th className="px-3 py-3 text-right">{m("單價")}</th><th className="px-3 py-3 text-right">{m("小計")}</th></tr></thead>
            <tbody className="divide-y divide-stone-200">{invoice.lineItems.map((line) => <tr key={line.id}><td className="px-3 py-4"><strong>{line.description}</strong><div className="mt-1 text-xs text-stone-500">{line.code}</div></td><td className="px-3 py-4 text-right">{formatAppNumber(locale, line.quantity)}</td><td className="px-3 py-4 text-right">{formatAppCurrency(locale, line.unitPrice, invoice.currency)}</td><td className="px-3 py-4 text-right font-medium">{formatAppCurrency(locale, line.subtotal, invoice.currency)}</td></tr>)}</tbody>
          </table>
        </div>
        <dl className="ml-auto mt-4 max-w-sm space-y-2 text-sm">
          <Row label={m("未稅小計")} value={formatAppCurrency(locale, invoice.subtotal, invoice.currency)} />
          <Row label={m("折扣")} value={formatAppCurrency(locale, invoice.discountAmount, invoice.currency)} />
          <Row label={m("稅額")} value={formatAppCurrency(locale, invoice.taxAmount, invoice.currency)} />
          <Row label={m("帳單總額")} value={formatAppCurrency(locale, invoice.totalAmount, invoice.currency)} strong />
          <Row label={m("已確認付款")} value={formatAppCurrency(locale, invoice.amountPaid, invoice.currency)} />
          <Row label={m("未付金額")} value={formatAppCurrency(locale, invoice.amountDue, invoice.currency)} strong />
        </dl>
      </section>

      <section className="border-t border-stone-200 py-6">
        <h2 className="text-xl font-semibold">{m("付款紀錄")}</h2>
        <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
          {invoice.manualPayments.map((payment) => <div key={payment.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]"><span>{label(paymentMethodLabels[payment.paymentMethod] ?? payment.paymentMethod)} · {label(paymentStatusLabels[payment.verificationStatus] ?? payment.verificationStatus)}</span><strong>{formatAppCurrency(locale, payment.amount, payment.currency)}</strong><time className="text-xs text-stone-500">{formatAppDateTime(locale, payment.receivedAt)}</time></div>)}
          {invoice.manualPayments.length === 0 ? <p className="py-6 text-sm text-stone-500">{m("尚未提交付款資料。")}</p> : null}
        </div>
      </section>

      {canManage && ["OPEN", "OVERDUE"].includes(invoice.status) && invoice.amountDue > 0 ? <ManualPaymentForm organizationId={workspace.id} invoiceId={invoice.id} amountDue={invoice.amountDue} currency={invoice.currency} /> : null}

      <section className="mt-6 border-y border-stone-200 bg-stone-50 py-4 text-sm text-stone-700">
        <strong>{m("電子發票整合尚未啟用")}</strong>
        <p className="mt-1">{m("Phase 1 僅提供 StallOrder 商業帳單與人工付款紀錄，不會向外部電子發票服務送出資料。")}</p>
      </section>
    </main>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-4"><dt className={strong ? "font-semibold" : "text-stone-600"}>{label}</dt><dd className={strong ? "font-semibold" : ""}>{value}</dd></div>;
}
