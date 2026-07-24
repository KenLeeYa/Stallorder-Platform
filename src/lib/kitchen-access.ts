import "server-only";

import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { hasPermission, type Permission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";
import { entitlementService } from "@/server/billing/entitlement-service";

export async function requireKitchenPage(
  requestedStallSlug: string | undefined,
  permission: Permission,
  returnPath: string,
) {
  const { workspaces } = await requireWorkspacePage();
  const availableStalls = workspaces.flatMap((workspace) => workspace.stalls)
    .filter((stall) => stall.isActive && stall.roles.some((role) => hasPermission(role, permission)))
    .map((stall) => ({ id: stall.id, slug: stall.slug, name: stall.name }));
  const selected = requestedStallSlug
    ? availableStalls.find((stall) => stall.slug === requestedStallSlug)
    : availableStalls[0];
  if (!selected) notFound();

  const authorization = await requirePagePermission(selected.slug, permission, returnPath);
  await entitlementService.assertFeatureEnabled(authorization.stall.organizationId, "KDS");
  return { ...authorization, availableStalls };
}

export async function requireKitchenManagementPage(stallId: string) {
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => (
    candidate.stalls.some((stall) => stall.id === stallId)
  ));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();

  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_KDS"))) notFound();

  await entitlementService.assertFeatureEnabled(workspace.id, "KDS");
  return { workspace, stall, roles };
}
