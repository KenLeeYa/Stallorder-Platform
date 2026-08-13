import Link from "next/link";
import { notFound } from "next/navigation";
import { AdditionalStallRequestForm } from "@/components/additional-stall-request-form";
import { BillingPageHeader } from "@/components/billing-navigation";
import { BillingStatusBanner } from "@/components/billing-status-banner";
import { getMerchantBillingPortalData } from "@/lib/billing-portal-data";
import { billingFeatureLabels, featureLabel, invoiceStatusLabels, subscriptionStatusLabels } from "@/lib/billing-labels";
import { requireBillingWorkspace } from "@/lib/billing-page";
import { formatAppCurrency, formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantBillingPage({ searchParams }: PageProps) {
  const { locale, m, label } = await getRequestMerchantMessages();
  const { organizationId } = await searchParams;
  const { workspace, canManage, canViewFinancials } = await requireBillingWorkspace(organizationId);
  const data = await getMerchantBillingPortalData(workspace.id);
  if (!data) notFound();
  const { subscription, usage, warnings, effectiveEntitlements, notifications } = data;
  const includedOrders = subscription.planVersion.includedOrders;
  const orderLimit = includedOrders === null ? null : includedOrders + usage.orderPackageQuantity;

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <BillingPageHeader organizationName={workspace.businessName} organizationId={workspace.id} active="billing" title={m("訂閱與帳務")} description={m("檢視目前方案、付款狀態、待辦申請與帳務通知。")} />
      <BillingStatusBanner status={subscription.status} trialEndsAt={subscription.trialEndsAt} paymentDueAt={subscription.paymentDueAt} />
      <section className="grid border-b border-stone-200 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={m("目前方案")} value={`${subscription.planVersion.displayName} v${formatAppNumber(locale, subscription.planVersion.version)}`} />
        <Metric label={m("訂閱狀態")} value={label(subscriptionStatusLabels[subscription.status] ?? subscription.status)} />
        <Metric label={m("本期訂單")} value={`${formatAppNumber(locale, usage.billableOrders)} / ${orderLimit === null ? m("依合約") : formatAppNumber(locale, orderLimit)}`} />
        <Metric label={m("有效攤位")} value={`${formatAppNumber(locale, usage.activeStalls)} / ${subscription.planVersion.maxStalls === null ? m("依合約") : formatAppNumber(locale, subscription.planVersion.maxStalls)}`} />
        <Metric label={m("計費期間")} value={m("{start} 至 {end}", { start: formatAppDate(locale, subscription.billingPeriodStart), end: formatAppDate(locale, subscription.billingPeriodEnd) })} />
        <Metric label={m("試用到期")} value={subscription.trialEndsAt ? formatAppDate(locale, subscription.trialEndsAt) : m("不適用")} />
        <Metric label={m("下次到期日")} value={subscription.paymentDueAt ? formatAppDate(locale, subscription.paymentDueAt) : m("待平台設定")} />
        <Metric label={m("付款週期")} value={subscription.billingInterval === "ANNUAL" ? m("年繳") : subscription.billingInterval === "MONTHLY" ? m("月繳") : m("試用")} />
      </section>

      {warnings.length > 0 ? <section className="border-b border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950"><h2 className="font-semibold">{m("用量提醒")}</h2><p className="mt-1">{m("目前已使用 {percentage}% 訂單額度；付費方案預設採軟性上限，不會在營業中突然停止接單。", { percentage: warnings.at(-1)?.percentage ?? 0 })}</p></section> : null}

      {canViewFinancials ? <section className="py-6"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{m("最近帳單")}</h2><Link href={`/merchant/billing/invoices?organizationId=${workspace.id}`} className="text-sm font-semibold text-teal-800">{m("查看全部")}</Link></div><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{subscription.invoices.slice(0, 5).map((invoice) => <Link key={invoice.id} href={`/merchant/billing/invoices/${invoice.id}?organizationId=${workspace.id}`} className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-4 py-3 text-sm"><span><strong>{invoice.invoiceNumber}</strong><span className="ml-3 text-stone-500">{label(invoiceStatusLabels[invoice.status] ?? invoice.status)}</span></span><strong>{m("{amount} 未付", { amount: formatAppCurrency(locale, invoice.amountDue, invoice.currency) })}</strong></Link>)}{subscription.invoices.length === 0 ? <p className="py-6 text-sm text-stone-500">{m("目前沒有帳單。")}</p> : null}</div></section> : null}

      <section className="grid gap-6 border-t border-stone-200 py-6 md:grid-cols-2">
        <div><h2 className="text-xl font-semibold">{m("已啟用功能")}</h2><ul className="mt-3 columns-1 space-y-2 text-sm text-stone-700 sm:columns-2">{effectiveEntitlements.filter((item) => item.isEnabled).map((item) => <li key={item.featureCode}>{label(featureLabel(item.featureCode))}</li>)}</ul></div>
        <div><h2 className="text-xl font-semibold">{m("未包含功能")}</h2><ul className="mt-3 columns-1 space-y-2 text-sm text-stone-500 sm:columns-2">{Object.keys(billingFeatureLabels).filter((code) => !effectiveEntitlements.some((item) => item.featureCode === code && item.isEnabled)).map((code) => <li key={code}>{label(featureLabel(code))}</li>)}</ul></div>
      </section>

      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("人工付款說明")}</h2><p className="mt-2 text-sm leading-6 text-stone-600">{m("請先等待平台建立正式帳單，再依雙方確認的銀行轉帳、現金或 LINE Pay 方式付款。送出參考資料不代表付款成功，必須由平台管理員核對後才會啟用或續訂。")}</p></section>

      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("可用訂單包")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{data.orderPackages.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span><strong>{item.displayName}</strong><span className="ml-2 text-stone-500">{m("需平台人工指派")}</span></span><strong>{formatAppCurrency(locale, item.unitPrice, item.currency)}</strong></div>)}</div></section>

      <section className="border-t border-stone-200 py-6"><h2 className="text-xl font-semibold">{m("帳務通知")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{notifications.slice(0, 8).map((notification) => <article key={notification.id} className="py-3"><div className="flex justify-between gap-3"><strong className="text-sm">{notification.title}</strong><time className="text-xs text-stone-500">{formatAppDate(locale, notification.createdAt)}</time></div><p className="mt-1 text-sm text-stone-600">{notification.message}</p></article>)}{notifications.length === 0 ? <p className="py-6 text-sm text-stone-500">{m("目前沒有帳務通知。")}</p> : null}</div></section>
      {canManage ? <AdditionalStallRequestForm organizationId={workspace.id} /> : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border-t border-stone-200 py-5 sm:px-4"><div className="text-sm text-stone-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}
