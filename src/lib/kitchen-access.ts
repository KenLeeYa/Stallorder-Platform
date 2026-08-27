import "server-only";

import { notFound } from "next/navigation";
import { loginPathForReturnPath } from "@/lib/login-routing";
import { hasPermission, resolvePrimaryRole, type Permission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";
import { entitlementService } from "@/server/billing/entitlement-service";

export async function requireKitchenPage(
  requestedStallSlug: string | undefined,
  permission: Permission,
) {
  const { principal, workspaces } = await requireWorkspacePage(loginPathForReturnPath("/kitchen"));
  const candidates = workspaces.flatMap((workspace) => workspace.stalls
    .filter((stall) => (
      stall.isActive
      && stall.kdsEnabled
      && stall.roles.some((role) => hasPermission(role, permission))
    ))
    .map((stall) => ({ workspace, stall })));
  const selected = requestedStallSlug
    ? candidates.find(({ stall }) => stall.slug === requestedStallSlug)
    : candidates[0];
  if (!selected) notFound();

  const availableStalls = candidates
    .filter(({ workspace }) => workspace.id === selected.workspace.id)
    .map(({ stall }) => ({
      id: stall.id,
      slug: stall.slug,
      name: stall.name,
    }));

  const roles = selected.stall.roles;
  const role = resolvePrimaryRole(roles);
  if (!role) notFound();

  await entitlementService.assertFeatureEnabled(selected.workspace.id, "KDS");
  return {
    principal,
    role,
    roles,
    workspaces,
    stall: {
      ...selected.stall,
      organization: { businessName: selected.workspace.businessName },
    },
    availableStalls,
  };
}

export async function requireKitchenManagementPage(stallId: string) {
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => (
    candidate.stalls.some((stall) => stall.id === stallId)
  ));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall || !stall.kdsEnabled) notFound();

  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_KDS"))) notFound();

  await entitlementService.assertFeatureEnabled(workspace.id, "KDS");
  return { workspace, stall, roles };
}
