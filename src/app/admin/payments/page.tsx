import Link from "next/link";
import { AdminPaymentReviewActions } from "@/components/admin-billing-actions";
import { getAdminPayments } from "@/lib/admin-billing-data";
import { paymentMethodLabels, paymentStatusLabels } from "@/lib/billing-labels";
import { formatMoney } from "@/lib/money";

export default async function AdminPaymentsPage() {
  const payments = await getAdminPayments();
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8"><header><h1 className="text-3xl font-semibold">人工付款審核</h1><p className="mt-2 text-sm text-stone-600">核對銀行轉帳、現金或 LINE Pay 人工紀錄；瀏覽器返回頁不能作為付款成功證明。</p></header><div className="mt-6 grid gap-4 lg:grid-cols-2">{payments.map((payment) => <article id={payment.id} key={payment.id} className="rounded-md border border-stone-200 p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">{payment.organization.businessName}</h2><Link href={`/admin/invoices/${payment.invoiceId}`} className="mt-1 block text-sm font-semibold text-teal-800">{payment.invoice.invoiceNumber}</Link></div><strong>{formatMoney(payment.amount, payment.currency)}</strong></div><dl className="mt-3 space-y-1 text-sm text-stone-600"><div className="flex justify-between gap-3"><dt>付款方式</dt><dd>{paymentMethodLabels[payment.paymentMethod] ?? payment.paymentMethod}</dd></div><div className="flex justify-between gap-3"><dt>狀態</dt><dd>{paymentStatusLabels[payment.verificationStatus] ?? payment.verificationStatus}</dd></div><div className="flex justify-between gap-3"><dt>登錄人</dt><dd>{payment.recordedBy.displayName}</dd></div><div className="flex justify-between gap-3"><dt>付款時間</dt><dd>{payment.receivedAt.toISOString()}</dd></div></dl>{payment.verificationStatus === "PENDING_VERIFICATION" ? <div className="mt-4"><AdminPaymentReviewActions paymentId={payment.id} /></div> : null}</article>)}{payments.length === 0 ? <p className="text-sm text-stone-500">目前沒有付款紀錄。</p> : null}</div></main>;
}
