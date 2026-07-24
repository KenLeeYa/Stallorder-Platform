import { notFound } from "next/navigation";
import { BillingPageHeader } from "@/components/billing-navigation";
import { PlanRequestForm } from "@/components/plan-request-form";
import { getMerchantBillingPortalData } from "@/lib/billing-portal-data";
import { featureLabel } from "@/lib/billing-labels";
import { requireBillingWorkspace } from "@/lib/billing-page";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantPlansPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspace, canManage } = await requireBillingWorkspace(organizationId);
  if (!canManage) notFound();
  const data = await getMerchantBillingPortalData(workspace.id);
  if (!data) notFound();
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <BillingPageHeader organizationName={workspace.businessName} organizationId={workspace.id} active="plans" title="選擇方案" description="送出申請後由平台管理員審核並建立人工付款帳單；送出申請不會立即扣款或變更權限。" />
      <PlanRequestForm organizationId={workspace.id} plans={data.availablePlans.map((version) => ({ id: version.id, name: version.displayName, code: version.plan.code, monthlyPrice: version.basePrice, annualPrice: version.annualPrice, currency: version.currency, includedOrders: version.includedOrders, includedStalls: version.includedStalls, maxStaff: version.maxStaff, maxProducts: version.maxProducts, features: version.entitlements.map((entitlement) => featureLabel(entitlement.featureCode)) }))} />
      <section className="mt-8 border-y border-stone-200 py-5"><h2 className="text-lg font-semibold">申請紀錄</h2><div className="mt-3 divide-y divide-stone-100">{data.subscription.billingChangeRequests.map((request) => <div key={request.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span>{request.requestType === "PLAN_CHANGE" ? request.requestedPlanVersion?.displayName ?? "方案變更" : `額外攤位 ${request.requestedQuantity ?? 0} 個`}</span><span>{requestStatus(request.status)} · {request.createdAt.toISOString().slice(0, 10)}</span></div>)}</div></section>
    </main>
  );
}

function requestStatus(status: string) {
  return ({ PENDING: "待審核", APPROVED: "已核准", REJECTED: "未通過", CANCELLED: "已取消" } as Record<string, string>)[status] ?? status;
}
