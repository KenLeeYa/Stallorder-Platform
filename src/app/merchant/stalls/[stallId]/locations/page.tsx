import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPinned } from "lucide-react";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { StallLocationManager } from "@/components/stall-location-manager";
import { hasPermission } from "@/lib/rbac";
import { getStallLocationManagerData } from "@/lib/stall-schedules";
import { requireWorkspacePage } from "@/lib/workspace";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function StallLocationsPage({ params }: PageProps) {
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();
  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_STALL_LOCATIONS"))) notFound();
  const access = await getFeatureAccess(workspace.id, "STALL_LOCATION");
  if (!access.allowed) return <FeatureUpgradeNotice title="出攤地點尚未開放" message={access.message} billingHref={`/merchant/subscription?organizationId=${workspace.id}`} />;
  const data = await getStallLocationManagerData(workspace.id, stallId);
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8"><Link href={`/merchant/stalls/${stallId}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回攤位設定</Link><header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><MapPinned className="h-7 w-7 text-teal-700" />常用出攤地點</h1><p className="mt-2 text-sm text-stone-600">{stall.name}</p></header><div className="py-7"><StallLocationManager stallId={stallId} initialData={data} /></div></main>;
}
