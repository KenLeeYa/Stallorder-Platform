import { NextResponse } from "next/server";
import { mobileBootstrapResponseSchema, mobilePermissionSchema } from "@stallorder/contracts/mobile/v1";
import { permissionsForRoles } from "@/lib/rbac";
import { getMemberWorkspaceAccess } from "@/lib/workspace";
import { authorizeMobileApiRequest } from "@/server/mobile/authorization";

export async function GET(request: Request) {
  const authorization = await authorizeMobileApiRequest(request);
  if (!authorization.ok) return authorization.response;

  const { principal, requestId, featureFlags } = authorization;
  const workspaces = principal.user.platformRole === "PLATFORM_ADMIN"
    ? []
    : await getMemberWorkspaceAccess(principal.user.id);
  const response = mobileBootstrapResponseSchema.parse({
    version: "v1",
    sessionExpiresAt: principal.sessionExpiresAt.toISOString(),
    principal: {
      id: principal.user.id,
      email: principal.user.email,
      displayName: principal.user.displayName,
      platformRole: principal.user.platformRole,
    },
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      businessName: workspace.businessName,
      slug: workspace.slug,
      status: workspace.status,
      defaultCurrency: workspace.defaultCurrency,
      roles: workspace.roles,
      permissions: permissionsForRoles(workspace.roles).filter(p => mobilePermissionSchema.safeParse(p).success),
      canUseAllStalls: workspace.canUseAllStalls,
      stalls: workspace.stalls.map((stall) => ({
        id: stall.id, organizationId: stall.organizationId, name: stall.name, slug: stall.slug, code: stall.code, businessStatus: stall.businessStatus, orderingEnabled: stall.orderingEnabled, isActive: stall.isActive, kdsEnabled: stall.kdsEnabled, roles: stall.roles,
        permissions: permissionsForRoles(stall.roles).filter(p => mobilePermissionSchema.safeParse(p).success),
      })),
    })),
    featureFlags: {
      mobileApp: featureFlags.mobileApp,
      platformAdmin: featureFlags.platformAdmin,
      push: featureFlags.push,
      offlinePos: featureFlags.offlinePos,
      directPrint: featureFlags.directPrint,
      localFixtureLab: false,
    },
  });

  return NextResponse.json(response, {
    headers: { "cache-control": "private, no-store", "x-request-id": requestId },
  });
}
