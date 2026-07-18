import { notFound } from "next/navigation";
import { MultiStallDashboard } from "@/components/multi-stall-dashboard";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function StallDashboardPage({ params }: PageProps) {
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();
  const roles = [...workspace.roles, ...stall.roles];
  if (!roles.some((role) => hasPermission(role, "VIEW_REPORTS"))) notFound();

  return (
    <MultiStallDashboard
      organizationId={workspace.id}
      organizationName={`${workspace.businessName} · ${stall.name}`}
      currency={workspace.defaultCurrency}
      stalls={[{
        id: stall.id,
        name: stall.name,
        slug: stall.slug,
        code: stall.code,
        businessStatus: stall.businessStatus,
        isActive: stall.isActive,
      }]}
      canManageOrdering={workspace.roles.some((role) => hasPermission(role, "MANAGE_ORDERING"))}
      multiStallEnabled={false}
      initialSelectedStallIds={[stall.id]}
    />
  );
}
