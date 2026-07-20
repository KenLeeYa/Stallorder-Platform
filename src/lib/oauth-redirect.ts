import type { UserRole } from "@prisma/client";
import { hasPermission } from "@/lib/rbac";

type OAuthWorkspace = {
  roles: UserRole[];
  stalls: Array<{ slug: string; roles: UserRole[] }>;
};

const invitationPath = /^\/invite\/[A-Za-z0-9_-]{40,100}$/;
const workspaceSelectionPaths = ["/select-organization", "/select-stall"];
const merchantRoles = new Set<UserRole>([
  "MERCHANT_OWNER",
  "MERCHANT_MANAGER",
  "ORGANIZATION_OWNER",
  "ORGANIZATION_ADMIN",
  "FINANCE_VIEWER",
  "STALL_MANAGER",
]);

function hasPathPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

function isWorkspaceSelectionPath(path: string) {
  return workspaceSelectionPaths.some((prefix) => hasPathPrefix(path, prefix));
}

export function resolveOAuthDestination(
  requestedNext: string,
  fallback: string,
  platformRole: UserRole | null,
  workspaces: OAuthWorkspace[],
) {
  if (!requestedNext) return fallback;
  if (invitationPath.test(requestedNext)) return requestedNext;
  if (requestedNext === "/") return fallback;

  if (platformRole === "PLATFORM_ADMIN") {
    return hasPathPrefix(requestedNext, "/admin")
      || hasPathPrefix(requestedNext, "/merchant")
      || hasPathPrefix(requestedNext, "/staff")
      || isWorkspaceSelectionPath(requestedNext)
      ? requestedNext
      : fallback;
  }

  if (workspaces.length === 0) {
    return hasPathPrefix(requestedNext, "/onboarding")
      || hasPathPrefix(requestedNext, "/access-pending")
      ? requestedNext
      : fallback;
  }

  if (isWorkspaceSelectionPath(requestedNext)) return requestedNext;

  const roles = new Set(workspaces.flatMap((workspace) => [
    ...workspace.roles,
    ...workspace.stalls.flatMap((stall) => stall.roles),
  ]));
  if (
    hasPathPrefix(requestedNext, "/merchant")
    && [...roles].some((role) => merchantRoles.has(role))
  ) {
    return requestedNext;
  }

  const staffMatch = requestedNext.match(/^\/staff\/([^/?#]+)(?:[/?#]|$)/);
  if (staffMatch) {
    const stall = workspaces
      .flatMap((workspace) => workspace.stalls)
      .find((candidate) => candidate.slug === staffMatch[1]);
    if (stall?.roles.some((role) => hasPermission(role, "VIEW_ORDERS"))) return requestedNext;
  }

  return fallback;
}
