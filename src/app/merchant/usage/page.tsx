import { notFound } from "next/navigation";
import { BillingPageHeader } from "@/components/billing-navigation";
import { getMerchantBillingPortalData } from "@/lib/billing-portal-data";
import { requireBillingWorkspace } from "@/lib/billing-page";
import { formatAppNumber } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantUsagePage({ searchParams }: PageProps) {
  const { locale, m } = await getRequestMerchantMessages();
  const { organizationId } = await searchParams;
  const { workspace } = await requireBillingWorkspace(organizationId);
  const data = await getMerchantBillingPortalData(workspace.id);
  if (!data) notFound();

  const { subscription, usage, warnings } = data;
  const includedOrders = subscription.planVersion.includedOrders;
  const orderLimit = includedOrders === null ? null : includedOrders + usage.orderPackageQuantity;
  const percentage = orderLimit && orderLimit > 0
    ? Math.round((usage.billableOrders / orderLimit) * 100)
    : null;

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <BillingPageHeader
        organizationName={workspace.businessName}
        organizationId={workspace.id}
        active="usage"
        title={m("方案用量")}
        description={m("用量以完成且首次計費的訂單為準；取消、拒絕與逾時訂單不會計入。")}
      />

      <section className="mt-6 grid border-y border-stone-200 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={m("本期計費訂單")} value={formatAppNumber(locale, usage.billableOrders)} />
        <Metric label={m("本期訂單額度")} value={orderLimit === null ? m("依合約") : formatAppNumber(locale, orderLimit)} />
        <Metric label={m("啟用攤位")} value={`${formatAppNumber(locale, usage.activeStalls)} / ${subscription.planVersion.maxStalls === null ? m("依合約") : formatAppNumber(locale, subscription.planVersion.maxStalls)}`} />
        <Metric label={m("啟用員工")} value={`${formatAppNumber(locale, usage.activeStaff)} / ${subscription.planVersion.maxStaff === null ? m("依合約") : formatAppNumber(locale, subscription.planVersion.maxStaff)}`} />
        <Metric label={m("商品數")} value={`${formatAppNumber(locale, usage.activeProducts)} / ${subscription.planVersion.maxProducts === null ? m("依合約") : formatAppNumber(locale, subscription.planVersion.maxProducts)}`} />
        <Metric label={m("QR Code 數")} value={`${formatAppNumber(locale, usage.activeQrCodes)} / ${subscription.planVersion.maxQrCodes === null ? m("依合約") : formatAppNumber(locale, subscription.planVersion.maxQrCodes)}`} />
        <Metric label={m("CSV 匯出次數")} value={formatAppNumber(locale, usage.csvExports)} />
        <Metric label={m("額度使用率")} value={percentage === null ? m("依合約") : formatAppNumber(locale, percentage / 100, { style: "percent", maximumFractionDigits: 0 })} />
      </section>

      <section className="py-6">
        <h2 className="text-xl font-semibold">{m("額度政策")}</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {subscription.planVersion.overagePolicy === "HARD_LIMIT"
            ? m("此方案採硬性上限。試用期到期或額度用完後，系統會停止建立新的公開點餐 session 與訂單，但歷史資料和帳務頁仍可查看。")
            : m("付費方案預設採軟性上限。超過包含額度時仍可接單，平台會通知升級或人工加購訂單包。")}
        </p>
        {warnings.length > 0 ? (
          <div className="mt-4 border-y border-amber-300 bg-amber-50 py-4 text-sm text-amber-950">
            <strong>{m("目前最高提醒層級：{percentage}%", { percentage: warnings.at(-1)?.percentage ?? 0 })}</strong>
            <p className="mt-1">{m("請檢視方案或聯絡平台管理員指派訂單包。")}</p>
          </div>
        ) : (
          <p className="mt-4 border-y border-emerald-200 bg-emerald-50 py-4 text-sm text-emerald-900">{m("目前沒有用量警示。")}</p>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-stone-200 py-5 sm:px-4 lg:last:border-b-0">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-1 break-words text-xl font-semibold">{value}</div>
    </div>
  );
}
