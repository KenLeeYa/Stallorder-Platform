import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { CalendarDays, Megaphone } from "lucide-react";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { MarketEventManager } from "@/components/market-event-manager";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { hasPermission } from "@/lib/rbac";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import {
  getMarketEventManagerData,
  StallScheduleOperationError,
} from "@/lib/stall-schedules";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string }> };

export default async function MarketEventsPage({ searchParams }: PageProps) {
  const { m } = await getRequestMerchantMessages();
  const { organizationId, stallId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_MARKET_EVENTS"))) notFound();
  const returnStallId = workspace.stalls.some((stall) => stall.id === stallId) ? stallId : undefined;
  const access = await getFeatureAccess(workspace.id, "STALL_SCHEDULE");
  if (!access.allowed) return <FeatureUpgradeNotice title={m("市集活動尚未開放")} message={access.message} billingHref={`/merchant/subscription?organizationId=${workspace.id}`} returnStallId={returnStallId} />;
  let data;
  try {
    data = await getMarketEventManagerData(workspace.id);
  } catch (error) {
    if (error instanceof StallScheduleOperationError && error.code === "EVENT_FEATURE_REQUIRED") {
      return <FeatureUpgradeNotice title={m("市集活動需要 Pro 方案")} message={m("目前方案可管理基本出攤行程；升級後可建立跨攤位市集活動。")} billingHref={`/merchant/subscription?organizationId=${workspace.id}`} returnStallId={returnStallId} />;
    }
    throw error;
  }
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">{returnStallId ? <div className="mb-4"><StallSettingsBackLink stallId={returnStallId} /></div> : null}<header className="border-b border-stone-200 pb-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><CalendarDays className="h-7 w-7 text-teal-700" />{m("市集活動")}</h1><p className="mt-2 text-sm text-stone-600">{m("集中管理可供多個攤位引用的活動場次。")}</p></div><Link href={`/merchant/event-growth?organizationId=${workspace.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-800"><Megaphone className="h-4 w-4" />活動推廣與成效</Link></div></header><div className="py-7"><MarketEventManager organizationId={workspace.id} initialData={data} /></div></main>;
}
