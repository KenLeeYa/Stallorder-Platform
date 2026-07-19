import { notFound } from "next/navigation";
import { MerchantSetupWizard } from "@/components/merchant-setup-wizard";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getMerchantSetupOverview } from "@/server/merchant-applications/merchant-setup-service";

export default async function MerchantSetupPage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.includes("ORGANIZATION_OWNER")) notFound();
  const setup = await getMerchantSetupOverview(workspace.id);
  if (!setup) notFound();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const query = `organizationId=${encodeURIComponent(workspace.id)}`;
  return <MerchantSetupWizard organizationId={workspace.id} stall={{ id: setup.stall.id, name: setup.stall.name, slug: setup.stall.slug, orderingState: setup.stall.orderingState, orderingEnabled: setup.stall.orderingEnabled, businessStatus: setup.stall.businessStatus }} qrCode={setup.qrCode} applicationNumber={setup.application.applicationNumber} subscription={{ status: setup.organization.subscription?.status ?? "未建立", planName: setup.organization.subscription ? `${setup.organization.subscription.planVersion.displayName} v${setup.organization.subscription.planVersion.version}` : "Trial", trialEndsAt: setup.organization.subscription?.trialEndsAt?.toISOString() ?? null }} appBaseUrl={baseUrl} goLiveCompleted={setup.goLiveCompleted} testOrder={setup.testOrder ? { orderNo: setup.testOrder.orderNo, status: setup.testOrder.status, isTest: setup.testOrder.isTest } : null} steps={[
    { key: "MERCHANT_PROFILE", label: "商家資料", description: `${setup.organization.businessName} · ${setup.organization.phone}`, completed: setup.merchantProfileCompleted, href: `/merchant/dashboard?${query}` },
    { key: "STALL_PROFILE", label: "攤位資料", description: `${setup.stall.name} · ${setup.stall.location}`, completed: setup.stallProfileCompleted, href: `/merchant/stalls/${setup.stall.id}?${query}` },
    { key: "CATALOG", label: "商品目錄", description: `目前 ${setup.activeProducts} 項可用商品`, completed: setup.catalogCompleted, href: `/merchant/catalog?${query}` },
    { key: "PAYMENT_OPTIONS", label: "付款方式", description: `目前 ${setup.paymentOptions} 個啟用選項`, completed: setup.paymentOptionsCompleted, href: `/merchant/stalls/${setup.stall.id}?${query}` },
    { key: "TEAM", label: "團隊成員", description: `目前 ${setup.teamMembers} 位組織成員，可確認暫不邀請`, completed: setup.teamSetupCompleted, href: `/merchant/team?${query}` },
    { key: "QR_PREVIEW", label: "QR 預覽", description: `QR v${setup.qrCode.tokenVersion} 目前維持 ${setup.qrCode.state}`, completed: setup.qrPreviewCompleted, href: `/merchant/localization/preview?${query}&stallId=${encodeURIComponent(setup.stall.id)}&locale=zh-TW` },
  ]} />;
}
