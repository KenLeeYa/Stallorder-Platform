import { notFound, redirect } from "next/navigation";
import { MultiStallDashboard } from "@/components/multi-stall-dashboard";
import { authorizedStallIdsForPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[] }> };

export default async function MerchantDashboardPage({ searchParams }: PageProps) {
  const { organizationId, stallId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const reportStallIds = new Set(authorizedStallIdsForPermission(workspace.stalls, "VIEW_REPORTS"));
  const reportStalls = workspace.stalls.filter((stall) => reportStallIds.has(stall.id));
  if (reportStalls.length === 0) notFound();

  const requestedStallIds = typeof stallId === "string" ? [stallId] : stallId ?? [];
  const initialSelectedStallIds = requestedStallIds.filter((id) => reportStallIds.has(id));

  return (
    <MultiStallDashboard
      organizationId={workspace.id}
      organizationName={workspace.businessName}
      currency={workspace.defaultCurrency}
      stalls={reportStalls.map((stall) => ({
        id: stall.id,
        name: stall.name,
        slug: stall.slug,
        code: stall.code,
        businessStatus: stall.businessStatus,
        isActive: stall.isActive,
      }))}
      canManageOrdering={authorizedStallIdsForPermission(reportStalls, "MANAGE_ORDERING").length > 0}
      initialSelectedStallIds={initialSelectedStallIds}
    />
  );
}
