import Link from "next/link";
import { getAdminInvoices } from "@/lib/admin-billing-data";
import { invoiceStatusLabels } from "@/lib/billing-labels";
import { formatMoney } from "@/lib/money";

export default async function AdminInvoicesPage() {
  const invoices = await getAdminInvoices();
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8"><header><h1 className="text-3xl font-semibold">帳單管理</h1><p className="mt-2 text-sm text-stone-600">所有金額均由伺服器端明細重新計算；瀏覽器不能指定最終總額。</p></header><div className="mt-6 overflow-x-auto border-y border-stone-200"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-stone-50 text-stone-600"><tr><th className="px-3 py-3">帳單</th><th className="px-3 py-3">商家</th><th className="px-3 py-3">狀態</th><th className="px-3 py-3">到期日</th><th className="px-3 py-3 text-right">總額</th><th className="px-3 py-3 text-right">未付</th><th className="px-3 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-stone-200">{invoices.map((invoice) => <tr key={invoice.id}><td className="px-3 py-4 font-semibold">{invoice.invoiceNumber}</td><td className="px-3 py-4">{invoice.organization.businessName}</td><td className="px-3 py-4">{invoiceStatusLabels[invoice.status] ?? invoice.status}</td><td className="px-3 py-4">{invoice.dueAt.toISOString().slice(0, 10)}</td><td className="px-3 py-4 text-right">{formatMoney(invoice.totalAmount, invoice.currency)}</td><td className="px-3 py-4 text-right">{formatMoney(invoice.amountDue, invoice.currency)}</td><td className="px-3 py-4 text-right"><Link href={`/admin/invoices/${invoice.id}`} className="font-semibold text-teal-800">管理</Link></td></tr>)}</tbody></table></div></main>;
}
