import "server-only";

import type { OrganizationStatus, UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { getPagePrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { defaultPathForRole } from "@/lib/auth";
import { resolvePrimaryRole } from "@/lib/rbac";

const accessibleOrganizationStatuses = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] as const;

export type WorkspaceStall = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  code: string;
  businessStatus: "OPEN" | "PAUSED" | "CLOSED" | "SOLD_OUT";
  orderingEnabled: boolean;
  isActive: boolean;
  roles: UserRole[];
};

export type WorkspaceOrganization = {
  id: string;
  name: string;
  businessName: string;
  slug: string;
  status: OrganizationStatus;
  defaultCurrency: string;
  roles: UserRole[];
  canUseAllStalls: boolean;
  stalls: WorkspaceStall[];
};

export async function getWorkspaceAccess(profileId: string, platformRole: UserRole | null) {
  const [organizationMemberships, stallMemberships] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { profileId, isActive: true },
      select: { organizationId: true, role: true, allStalls: true },
    }),
    prisma.stallMembership.findMany({
      where: { profileId, isActive: true },
      select: { organizationId: true, stallId: true, role: true },
    }),
  ]);

  const organizationIds = platformRole === "PLATFORM_ADMIN"
    ? undefined
    : [...new Set([
      ...organizationMemberships.map((membership) => membership.organizationId),
      ...stallMemberships.map((membership) => membership.organizationId),
    ])];

  if (organizationIds?.length === 0) return [];

  const organizations = await prisma.organization.findMany({
    where: {
      id: organizationIds ? { in: organizationIds } : undefined,
      status: { in: [...accessibleOrganizationStatuses] },
    },
    include: {
      stalls: {
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return organizations.map((organization): WorkspaceOrganization => {
    const organizationAccess = organizationMemberships.filter(
      (membership) => membership.organizationId === organization.id,
    );
    const organizationRoles = platformRole === "PLATFORM_ADMIN"
      ? ["PLATFORM_ADMIN" as UserRole]
      : [...new Set(organizationAccess.map((membership) => membership.role))];
    const hasAllStallAccess = platformRole === "PLATFORM_ADMIN"
      || organizationAccess.some(
        (membership) => membership.role === "ORGANIZATION_OWNER" || membership.allStalls,
      );
    const assignedStallIds = new Set(
      stallMemberships
        .filter((membership) => membership.organizationId === organization.id)
        .map((membership) => membership.stallId),
    );

    const stalls = organization.stalls
      .filter((stall) => hasAllStallAccess || assignedStallIds.has(stall.id))
      .map((stall): WorkspaceStall => ({
        id: stall.id,
        organizationId: organization.id,
        name: stall.name,
        slug: stall.slug,
        code: stall.code,
        businessStatus: stall.businessStatus,
        orderingEnabled: stall.orderingEnabled,
        isActive: stall.isActive,
        roles: [...new Set([
          ...organizationRoles,
          ...stallMemberships
            .filter((membership) => membership.stallId === stall.id)
            .map((membership) => membership.role),
        ])],
      }));

    return {
      id: organization.id,
      name: organization.name,
      businessName: organization.businessName,
      slug: organization.slug,
      status: organization.status,
      defaultCurrency: organization.defaultCurrency,
      roles: organizationRoles,
      canUseAllStalls: organizationRoles.length > 0,
      stalls,
    };
  });
}

export function getDefaultWorkspacePath(workspaces: WorkspaceOrganization[]) {
  if (workspaces.length === 0) return "/onboarding";
  if (workspaces.length > 1) return "/select-organization";

  const workspace = workspaces[0];
  if (workspace.canUseAllStalls) return `/merchant/dashboard?organizationId=${workspace.id}`;
  const activeStalls = workspace.stalls.filter((stall) => stall.isActive);
  if (activeStalls.length !== 1) return `/select-stall?organizationId=${workspace.id}`;

  const stall = activeStalls[0];
  const role = resolvePrimaryRole(stall.roles);
  return role ? defaultPathForRole(role, stall.slug) : "/select-stall";
}

export async function requireWorkspacePage() {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login");

  const workspaces = await getWorkspaceAccess(principal.user.id, principal.user.platformRole);
  if (workspaces.length === 0) redirect("/onboarding");
  return { principal, workspaces };
}

export function requireWorkspaceOrganization(
  workspaces: WorkspaceOrganization[],
  organizationId: string | undefined,
) {
  const workspace = organizationId
    ? workspaces.find((candidate) => candidate.id === organizationId)
    : workspaces.length === 1
      ? workspaces[0]
      : null;
  if (!workspace) notFound();
  return workspace;
}
