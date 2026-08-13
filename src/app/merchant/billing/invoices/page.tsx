import Link from "next/link";
import { notFound } from "next/navigation";
import { BillingPageHeader } from "@/components/billing-navigation";
import { getMerchantBillingPortalData } from "@/lib/billing-portal-data";
import { invoiceStatusLabels } from "@/lib/billing-labels";
import { requireBillingWorkspace } from "@/lib/billing-page";
import { formatAppCurrency, formatAppDate } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantInvoicesPage({ searchParams }: PageProps) {
  const { locale, m } = await getRequestMerchantMessages();
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
        title={m("帳單紀錄")}
        description={m("帳單價格與明細由平台依方案版本及核准項目建立，付款確認前不會變更訂閱權限。")}
      />
      <div className="mt-6 overflow-x-auto border-y border-stone-200">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
            <tr><th className="px-3 py-3">{m("帳單編號")}</th><th className="px-3 py-3">{m("期間")}</th><th className="px-3 py-3">{m("狀態")}</th><th className="px-3 py-3 text-right">{m("總額")}</th><th className="px-3 py-3 text-right">{m("未付")}</th><th className="px-3 py-3"><span className="sr-only">{m("操作")}</span></th></tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {data.subscription.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-3 py-4 font-semibold">{invoice.invoiceNumber}</td>
                <td className="px-3 py-4 text-stone-600">{m("{start} 至 {end}", { start: formatAppDate(locale, invoice.billingPeriodStart), end: formatAppDate(locale, invoice.billingPeriodEnd) })}</td>
                <td className="px-3 py-4">{invoiceStatusLabels[invoice.status] ?? invoice.status}</td>
                <td className="px-3 py-4 text-right font-medium">{formatAppCurrency(locale, invoice.totalAmount, invoice.currency)}</td>
                <td className="px-3 py-4 text-right">{formatAppCurrency(locale, invoice.amountDue, invoice.currency)}</td>
                <td className="px-3 py-4 text-right"><Link className="font-semibold text-teal-800" href={`/merchant/billing/invoices/${invoice.id}?organizationId=${workspace.id}`}>{m("查看")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.subscription.invoices.length === 0 ? <p className="px-3 py-8 text-sm text-stone-500">{m("目前沒有帳單。")}</p> : null}
      </div>
    </main>
  );
}
