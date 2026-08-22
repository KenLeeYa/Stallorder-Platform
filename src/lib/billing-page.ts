import "server-only";

import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getBillingExperienceState } from "@/server/billing/billing-feature-flags";

export async function requireBillingWorkspace(organizationId?: string) {
  const [{ principal, workspaces }, billingExperience] = await Promise.all([
    requireWorkspacePage(),
    getBillingExperienceState(),
  ]);
  if (!billingExperience.merchantBillingVisible) notFound();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "VIEW_BILLING"))) notFound();
  const canManage = workspace.roles.some((role) => hasPermission(role, "MANAGE_SUBSCRIPTION"));
  const canViewFinancials = workspace.roles.some((role) => (
    role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER" || role === "FINANCE_VIEWER"
  ));
  return { principal, workspace, canManage, canViewFinancials };
}
