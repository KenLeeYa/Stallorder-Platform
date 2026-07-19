import Link from "next/link";
import { notFound } from "next/navigation";
import { BillingPageHeader } from "@/components/billing-navigation";
import { getMerchantBillingPortalData } from "@/lib/billing-portal-data";
import { invoiceStatusLabels } from "@/lib/billing-labels";
import { requireBillingWorkspace } from "@/lib/billing-page";
import { formatMoney } from "@/lib/money";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantInvoicesPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspace, canViewFinancials } = await requireBillingWorkspace(organizationId);
  if (!canViewFinancials) notFound();
  const data = await getMerchantBillingPortalData(workspace.id);
  if (!data) notFound();

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <BillingPageHeader
        organizationName={workspace.businessName}
        organizationId={workspace.id}
        active="invoices"
        title="帳單紀錄"
        description="帳單價格與明細由平台依方案版本及核准項目建立，付款確認前不會變更訂閱權限。"
      />
      <div className="mt-6 overflow-x-auto border-y border-stone-200">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
            <tr><th className="px-3 py-3">帳單編號</th><th className="px-3 py-3">期間</th><th className="px-3 py-3">狀態</th><th className="px-3 py-3 text-right">總額</th><th className="px-3 py-3 text-right">未付</th><th className="px-3 py-3"><span className="sr-only">操作</span></th></tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {data.subscription.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-3 py-4 font-semibold">{invoice.invoiceNumber}</td>
                <td className="px-3 py-4 text-stone-600">{dateOnly(invoice.billingPeriodStart)} 至 {dateOnly(invoice.billingPeriodEnd)}</td>
                <td className="px-3 py-4">{invoiceStatusLabels[invoice.status] ?? invoice.status}</td>
                <td className="px-3 py-4 text-right font-medium">{formatMoney(invoice.totalAmount, invoice.currency)}</td>
                <td className="px-3 py-4 text-right">{formatMoney(invoice.amountDue, invoice.currency)}</td>
                <td className="px-3 py-4 text-right"><Link className="font-semibold text-teal-800" href={`/merchant/billing/invoices/${invoice.id}?organizationId=${workspace.id}`}>查看</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.subscription.invoices.length === 0 ? <p className="px-3 py-8 text-sm text-stone-500">目前沒有帳單。</p> : null}
      </div>
    </main>
  );
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
