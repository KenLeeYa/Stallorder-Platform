import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarRange, ExternalLink } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { StallScheduleManager } from "@/components/stall-schedule-manager";
import { hasPermission } from "@/lib/rbac";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { getStallScheduleManagerData } from "@/lib/stall-schedules";
import { requireWorkspacePage } from "@/lib/workspace";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function StallSchedulePage({ params }: PageProps) {
  const { m } = await getRequestMerchantMessages();
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();
  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_STALL_SCHEDULES"))) notFound();
  const access = await getFeatureAccess(workspace.id, "STALL_SCHEDULE");
  if (!access.allowed) return <FeatureUpgradeNotice title={m("出攤行程尚未開放")} message={access.message} billingHref={`/merchant/subscription?organizationId=${workspace.id}`} returnHref={`/merchant/stalls/${stallId}`} returnLabel={m("返回攤位設定")} />;
  const data = await getStallScheduleManagerData(workspace.id, stallId);
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8"><div className="flex flex-wrap items-center justify-between gap-3"><ContextualBackButton fallbackHref={`/merchant/stalls/${stallId}`}>{m("返回攤位設定")}</ContextualBackButton><Link href={`/s/${encodeURIComponent(stall.code.toLowerCase())}/schedule`} target="_blank" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><ExternalLink className="h-4 w-4" />{m("公開行程預覽")}</Link></div><header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><CalendarRange className="h-7 w-7 text-teal-700" />{m("出攤行程與接單時段")}</h1><p className="mt-2 text-sm text-stone-600">{stall.name}</p></header><div className="py-7"><StallScheduleManager stallId={stallId} initialData={data} /></div></main>;
}
