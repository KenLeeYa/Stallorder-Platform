import { notFound, redirect } from "next/navigation";
import { BriefcaseBusiness } from "lucide-react";
import { WorkforceManager } from "@/components/workforce-manager";
import { authorizedStallIdsForPermission, hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getWorkforceDashboard } from "@/server/workforce/workforce-service";

type PageProps = {
  searchParams: Promise<{ organizationId?: string; dateFrom?: string; dateTo?: string }>;
};

export default async function WorkforcePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!query.organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, query.organizationId);
  const roles = [...workspace.roles, ...workspace.stalls.flatMap((stall) => stall.roles)];
  if (!roles.some((role) => hasPermission(role, "MANAGE_ATTENDANCE"))) notFound();
  const authorizedStallIds = authorizedStallIdsForPermission(workspace.stalls, "MANAGE_ATTENDANCE");
  if (!workspace.canUseAllStalls && authorizedStallIds.length === 0) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = validDate(query.dateFrom) ? query.dateFrom : `${today.slice(0, 8)}01`;
  const dateTo = validDate(query.dateTo) ? query.dateTo : today;
  const dashboard = await getWorkforceDashboard({
    organizationId: workspace.id,
    dateFrom,
    dateTo,
    accessScope: { canUseAllStalls: workspace.canUseAllStalls, authorizedStallIds },
  });

  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-5 md:px-8 md:py-7">
    <header className="border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><BriefcaseBusiness className="h-7 w-7 text-teal-700" />員工排班與薪資</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">將核准打卡、時薪、休息時間、排休與假日倍率串成可覆核的薪資快照。</p></header>
    <div className="py-6"><WorkforceManager organizationId={workspace.id} initialDashboard={dashboard} /></div>
  </main>;
}

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}
