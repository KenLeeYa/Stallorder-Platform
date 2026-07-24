import "server-only";

import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

export async function requireBillingWorkspace(organizationId?: string) {
  const { principal, workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "VIEW_BILLING"))) notFound();
  const canManage = workspace.roles.some((role) => hasPermission(role, "MANAGE_SUBSCRIPTION"));
  const canViewFinancials = workspace.roles.some((role) => (
    role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER" || role === "FINANCE_VIEWER"
  ));
  return { principal, workspace, canManage, canViewFinancials };
}
