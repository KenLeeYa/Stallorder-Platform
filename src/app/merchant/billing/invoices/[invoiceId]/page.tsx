import Link from "next/link";
import { notFound } from "next/navigation";
import { ManualPaymentForm } from "@/components/manual-payment-form";
import { getInvoiceForMerchant } from "@/lib/billing-portal-data";
import { invoiceStatusLabels, paymentMethodLabels, paymentStatusLabels } from "@/lib/billing-labels";
import { requireBillingWorkspace } from "@/lib/billing-page";
import { formatMoney } from "@/lib/money";

type PageProps = {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ organizationId?: string }>;
};

export default async function MerchantInvoiceDetailPage({ params, searchParams }: PageProps) {
  const [{ invoiceId }, { organizationId }] = await Promise.all([params, searchParams]);
  const { workspace, canManage, canViewFinancials } = await requireBillingWorkspace(organizationId);
  if (!canViewFinancials) notFound();
  const invoice = await getInvoiceForMerchant(workspace.id, invoiceId);
  if (!invoice) notFound();

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      <Link href={`/merchant/billing/invoices?organizationId=${workspace.id}`} className="text-sm font-semibold text-teal-800">返回帳單列表</Link>
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-3xl font-semibold">{invoice.invoiceNumber}</h1><p className="mt-2 text-sm text-stone-600">{dateOnly(invoice.billingPeriodStart)} 至 {dateOnly(invoice.billingPeriodEnd)}</p></div>
          <strong className="text-lg">{invoiceStatusLabels[invoice.status] ?? invoice.status}</strong>
        </div>
      </header>

      <section className="py-6">
        <h2 className="text-xl font-semibold">帳單明細</h2>
        <div className="mt-3 overflow-x-auto border-y border-stone-200">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-stone-50 text-stone-600"><tr><th className="px-3 py-3">項目</th><th className="px-3 py-3 text-right">數量</th><th className="px-3 py-3 text-right">單價</th><th className="px-3 py-3 text-right">小計</th></tr></thead>
            <tbody className="divide-y divide-stone-200">{invoice.lineItems.map((line) => <tr key={line.id}><td className="px-3 py-4"><strong>{line.description}</strong><div className="mt-1 text-xs text-stone-500">{line.code}</div></td><td className="px-3 py-4 text-right">{line.quantity}</td><td className="px-3 py-4 text-right">{formatMoney(line.unitPrice, invoice.currency)}</td><td className="px-3 py-4 text-right font-medium">{formatMoney(line.subtotal, invoice.currency)}</td></tr>)}</tbody>
          </table>
        </div>
        <dl className="ml-auto mt-4 max-w-sm space-y-2 text-sm">
          <Row label="未稅小計" value={formatMoney(invoice.subtotal, invoice.currency)} />
          <Row label="折扣" value={formatMoney(invoice.discountAmount, invoice.currency)} />
          <Row label="稅額" value={formatMoney(invoice.taxAmount, invoice.currency)} />
          <Row label="帳單總額" value={formatMoney(invoice.totalAmount, invoice.currency)} strong />
          <Row label="已確認付款" value={formatMoney(invoice.amountPaid, invoice.currency)} />
          <Row label="未付金額" value={formatMoney(invoice.amountDue, invoice.currency)} strong />
        </dl>
      </section>

      <section className="border-t border-stone-200 py-6">
        <h2 className="text-xl font-semibold">付款紀錄</h2>
        <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
          {invoice.manualPayments.map((payment) => <div key={payment.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]"><span>{paymentMethodLabels[payment.paymentMethod] ?? payment.paymentMethod} · {paymentStatusLabels[payment.verificationStatus] ?? payment.verificationStatus}</span><strong>{formatMoney(payment.amount, payment.currency)}</strong><time className="text-xs text-stone-500">{payment.receivedAt.toISOString()}</time></div>)}
          {invoice.manualPayments.length === 0 ? <p className="py-6 text-sm text-stone-500">尚未提交付款資料。</p> : null}
        </div>
      </section>

      {canManage && ["OPEN", "OVERDUE"].includes(invoice.status) && invoice.amountDue > 0 ? <ManualPaymentForm organizationId={workspace.id} invoiceId={invoice.id} amountDue={invoice.amountDue} currency={invoice.currency} /> : null}

      <section className="mt-6 border-y border-stone-200 bg-stone-50 py-4 text-sm text-stone-700">
        <strong>電子發票整合尚未啟用</strong>
        <p className="mt-1">Phase 1 僅提供 StallOrder 商業帳單與人工付款紀錄，不會向外部電子發票服務送出資料。</p>
      </section>
    </main>
  );
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-4"><dt className={strong ? "font-semibold" : "text-stone-600"}>{label}</dt><dd className={strong ? "font-semibold" : ""}>{value}</dd></div>;
}
