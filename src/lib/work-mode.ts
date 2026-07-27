import type { UserRole } from "@prisma/client";
import { hasPermission } from "@/lib/rbac";

export type WorkMode = "MERCHANT" | "STAFF" | "KITCHEN";

export type WorkModeWorkspace = {
  id: string;
  businessName: string;
  roles: readonly UserRole[];
  stalls: readonly {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    roles: readonly UserRole[];
  }[];
};

export type WorkModeDestination = {
  value: string;
  mode: WorkMode;
  organizationId: string;
  stallId: string | null;
  label: string;
  href: string;
};

export function buildWorkModeDestinations(
  workspaces: readonly WorkModeWorkspace[],
): WorkModeDestination[] {
  const showOrganizationName = workspaces.length > 1;
  return workspaces.flatMap((workspace) => {
    const activeStalls = workspace.stalls.filter((stall) => stall.isActive);
    const canUseMerchantMode = [
      ...workspace.roles,
      ...activeStalls.flatMap((stall) => stall.roles),
    ].some((role) => (
      hasPermission(role, "VIEW_REPORTS")
      || hasPermission(role, "MANAGE_STALL")
      || hasPermission(role, "MANAGE_PRODUCTS")
    ));
    const organizationSuffix = showOrganizationName ? ` · ${workspace.businessName}` : "";
    const destinations: WorkModeDestination[] = canUseMerchantMode
      ? [{
          value: `merchant:${workspace.id}`,
          mode: "MERCHANT",
          organizationId: workspace.id,
          stallId: null,
          label: `商家管理${organizationSuffix}`,
          href: `/merchant/dashboard?organizationId=${encodeURIComponent(workspace.id)}`,
        }]
      : [];

    for (const stall of activeStalls) {
      const stallSuffix = showOrganizationName
        ? `${stall.name} · ${workspace.businessName}`
        : stall.name;
      if (stall.roles.some((role) => hasPermission(role, "VIEW_ORDERS"))) {
        destinations.push({
          value: `staff:${stall.id}`,
          mode: "STAFF",
          organizationId: workspace.id,
          stallId: stall.id,
          label: `店員 · ${stallSuffix}`,
          href: `/staff/${encodeURIComponent(stall.slug)}`,
        });
      }
      if (stall.roles.some((role) => hasPermission(role, "VIEW_KDS"))) {
        destinations.push({
          value: `kitchen:${stall.id}`,
          mode: "KITCHEN",
          organizationId: workspace.id,
          stallId: stall.id,
          label: `廚房 · ${stallSuffix}`,
          href: `/kitchen?stall=${encodeURIComponent(stall.slug)}`,
        });
      }
    }

    return destinations;
  });
}

export function currentWorkModeValue(
  mode: WorkMode,
  organizationId: string,
  stallId?: string,
) {
  if (mode === "MERCHANT") return `merchant:${organizationId}`;
  return stallId ? `${mode.toLowerCase()}:${stallId}` : "";
}
