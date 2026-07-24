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
