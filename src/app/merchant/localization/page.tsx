import { notFound, redirect } from "next/navigation";
import { LocalizationDashboard } from "@/components/localization-dashboard";
import { getLocalizationOverview } from "@/lib/localization-data";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function LocalizationPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) notFound();

  const overview = await getLocalizationOverview(workspace.id, workspace.stalls.map((stall) => stall.id));
  return <LocalizationDashboard organizationId={workspace.id} coverage={overview.coverage} stalls={overview.stalls} />;
}
