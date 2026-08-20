import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Store } from "lucide-react";
import { MerchantSetupWizard } from "@/components/merchant-setup-wizard";
import { formatAppNumber } from "@/lib/locale-format";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getMerchantSetupOverview } from "@/server/merchant-applications/merchant-setup-service";

export default async function MerchantSetupPage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const { locale, m } = await getRequestMerchantMessages();
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.includes("ORGANIZATION_OWNER")) notFound();
  const setup = await getMerchantSetupOverview(workspace.id);
  if (!setup) {
    const query = `organizationId=${encodeURIComponent(workspace.id)}`;
    return (
      <main className="mx-auto min-h-[calc(100vh-76px)] max-w-3xl px-4 py-8 md:px-8">
        <header className="border-b border-stone-200 pb-5">
          <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
          <h1 className="mt-1 text-3xl font-semibold">{m("開店設定")}</h1>
        </header>
        <section className="py-7">
          <div className="flex items-start gap-3">
            <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-teal-700" />
            <div>
              <h2 className="text-xl font-semibold">{m("目前沒有待完成的開店流程")}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {m("此組織不是由核准後的商家申請流程建立；既有攤位可直接從管理頁調整營運狀態與接單設定。")}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/merchant/stalls?${query}`} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white">
              <Store className="h-4 w-4" />
              {m("管理攤位")}
            </Link>
            <Link href={`/merchant/dashboard?${query}`} className="inline-flex min-h-11 items-center rounded-md border border-stone-300 px-4 text-sm font-semibold">
              {m("返回儀表板")}
            </Link>
          </div>
        </section>
      </main>
    );
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const query = `organizationId=${encodeURIComponent(workspace.id)}`;
  return <MerchantSetupWizard organizationId={workspace.id} stall={{ id: setup.stall.id, name: setup.stall.name, slug: setup.stall.slug, orderingState: setup.stall.orderingState, orderingEnabled: setup.stall.orderingEnabled, businessStatus: setup.stall.businessStatus }} qrCode={setup.qrCode} applicationNumber={setup.application.applicationNumber} subscription={{ status: setup.organization.subscription?.status ?? m("未建立"), planName: setup.organization.subscription ? `${setup.organization.subscription.planVersion.displayName} v${setup.organization.subscription.planVersion.version}` : m("試用"), trialEndsAt: setup.organization.subscription?.trialEndsAt?.toISOString() ?? null }} appBaseUrl={baseUrl} goLiveCompleted={setup.goLiveCompleted} testOrder={setup.testOrder ? { orderNo: setup.testOrder.orderNo, status: setup.testOrder.status, isTest: setup.testOrder.isTest } : null} steps={[
    { key: "MERCHANT_PROFILE", label: m("商家資料"), description: `${setup.organization.businessName} · ${setup.organization.phone}`, completed: setup.merchantProfileCompleted, href: `/merchant/organization?${query}&source=setup` },
    { key: "STALL_PROFILE", label: m("攤位資料"), description: `${setup.stall.name} · ${setup.stall.location}`, completed: setup.stallProfileCompleted, href: `/merchant/stalls/${setup.stall.id}/settings/basic?source=setup` },
    { key: "CATALOG", label: m("商品目錄"), description: m("目前 {count} 項可用商品", { count: formatAppNumber(locale, setup.activeProducts) }), completed: setup.catalogCompleted, href: `/merchant/catalog?${query}&source=setup` },
    { key: "PAYMENT_OPTIONS", label: m("付款方式"), description: m("目前 {count} 個啟用選項", { count: formatAppNumber(locale, setup.paymentOptions) }), completed: setup.paymentOptionsCompleted, href: `/merchant/stalls/${setup.stall.id}/settings/modules?source=setup#payment-options` },
    { key: "TEAM", label: m("團隊成員"), description: m("目前 {count} 位組織成員，可確認暫不邀請", { count: formatAppNumber(locale, setup.teamMembers) }), completed: setup.teamSetupCompleted, href: `/merchant/team?${query}&source=setup` },
    { key: "QR_PREVIEW", label: m("QR 預覽"), description: m("QR v{version} 目前維持 {state}", { version: setup.qrCode.tokenVersion, state: setup.qrCode.state }), completed: setup.qrPreviewCompleted, href: `/merchant/localization/preview?${query}&stallId=${encodeURIComponent(setup.stall.id)}&locale=zh-TW&source=setup` },
  ]} />;
}
