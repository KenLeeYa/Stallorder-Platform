import { notFound } from "next/navigation";
import { BillingPageHeader } from "@/components/billing-navigation";
import { PlanRequestForm } from "@/components/plan-request-form";
import { getMerchantBillingPortalData } from "@/lib/billing-portal-data";
import { featureLabel } from "@/lib/billing-labels";
import { requireBillingWorkspace } from "@/lib/billing-page";
import { formatAppDate, formatAppNumber } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantPlansPage({ searchParams }: PageProps) {
  const { locale, m, label } = await getRequestMerchantMessages();
  const { organizationId } = await searchParams;
  const { workspace, canManage } = await requireBillingWorkspace(organizationId);
  if (!canManage) notFound();
  const data = await getMerchantBillingPortalData(workspace.id);
  if (!data) notFound();
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <BillingPageHeader organizationName={workspace.businessName} organizationId={workspace.id} active="plans" title={m("選擇方案")} description={m("送出申請後由平台管理員審核並建立人工付款帳單；送出申請不會立即扣款或變更權限。")} />
      <PlanRequestForm organizationId={workspace.id} plans={data.availablePlans.map((version) => ({ id: version.id, name: version.displayName, code: version.plan.code, monthlyPrice: version.basePrice, annualPrice: version.annualPrice, currency: version.currency, includedOrders: version.includedOrders, includedStalls: version.includedStalls, maxStaff: version.maxStaff, maxProducts: version.maxProducts, features: version.entitlements.map((entitlement) => label(featureLabel(entitlement.featureCode))) }))} />
      <section className="mt-8 border-y border-stone-200 py-5"><h2 className="text-lg font-semibold">{m("申請紀錄")}</h2><div className="mt-3 divide-y divide-stone-100">{data.subscription.billingChangeRequests.map((request) => <div key={request.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span>{request.requestType === "PLAN_CHANGE" ? request.requestedPlanVersion?.displayName ?? m("方案變更") : m("額外攤位 {count} 個", { count: formatAppNumber(locale, request.requestedQuantity ?? 0) })}</span><span>{requestStatus(request.status, m)} · {formatAppDate(locale, request.createdAt)}</span></div>)}</div></section>
    </main>
  );
}

function requestStatus(
  status: string,
  m: Awaited<ReturnType<typeof getRequestMerchantMessages>>["m"],
) {
  return ({ PENDING: m("待審核"), APPROVED: m("已核准"), REJECTED: m("未通過"), CANCELLED: m("已取消") } as Record<string, string>)[status] ?? status;
}
