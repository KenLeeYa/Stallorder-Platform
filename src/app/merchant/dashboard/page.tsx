import { notFound, redirect } from "next/navigation";
import { MultiStallDashboard } from "@/components/multi-stall-dashboard";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[] }> };

export default async function MerchantDashboardPage({ searchParams }: PageProps) {
  const { organizationId, stallId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const effectiveRoles = [...workspace.roles, ...workspace.stalls.flatMap((stall) => stall.roles)];
  if (!effectiveRoles.some((role) => hasPermission(role, "VIEW_REPORTS"))) notFound();

  const requestedStallIds = typeof stallId === "string" ? [stallId] : stallId ?? [];
  const authorizedIds = new Set(workspace.stalls.map((stall) => stall.id));
  const initialSelectedStallIds = requestedStallIds.filter((id) => authorizedIds.has(id));

  return (
    <MultiStallDashboard
      organizationId={workspace.id}
      organizationName={workspace.businessName}
      currency={workspace.defaultCurrency}
      stalls={workspace.stalls.map((stall) => ({
        id: stall.id,
        name: stall.name,
        slug: stall.slug,
        code: stall.code,
        businessStatus: stall.businessStatus,
        isActive: stall.isActive,
      }))}
      canManageOrdering={workspace.roles.some((role) => hasPermission(role, "MANAGE_ORDERING"))}
      initialSelectedStallIds={initialSelectedStallIds}
    />
  );
}
