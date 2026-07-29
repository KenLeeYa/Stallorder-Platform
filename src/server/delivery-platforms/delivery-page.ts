import "server-only";

import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";
import { getFeatureAccess } from "@/server/billing/feature-access";
import { resolveDeliveryFeatureState } from "./delivery-feature-flags";

export async function requireMerchantDeliveryPage(input: {
  stallId?: string;
  returnPath: string;
}) {
  const { workspaces } = await requireWorkspacePage();
  const candidates = workspaces.flatMap((workspace) => (
    workspace.stalls.map((stall) => ({ workspace, stall }))
  ));
  const selected = input.stallId
    ? candidates.find(({ stall }) => stall.id === input.stallId)
    : candidates.find(({ workspace, stall }) => (
        stall.isActive
        && [...workspace.roles, ...stall.roles].some(
          (role) => hasPermission(role, "MANAGE_DELIVERY_INTEGRATIONS"),
        )
      ));
  if (!selected) {
    if (!input.stallId && workspaces.length > 0) {
      redirect(`/merchant/stalls?organizationId=${workspaces[0].id}`);
    }
    notFound();
  }
  const roles = [...new Set([...selected.workspace.roles, ...selected.stall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_DELIVERY_INTEGRATIONS"))) {
    notFound();
  }
  const featureState = await resolveDeliveryFeatureState("UBER_EATS", {
    organizationId: selected.workspace.id,
    stallId: selected.stall.id,
  });
  if (!featureState.foundation || !featureState.ui) notFound();
  const access = await getFeatureAccess(
    selected.workspace.id,
    "DELIVERY_PLATFORM_INTEGRATIONS",
  );
  return { ...selected, roles, featureState, access };
}
