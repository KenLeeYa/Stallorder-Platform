import type { WorkspaceOrganization, WorkspaceStall } from "@/lib/workspace";

export const MERCHANT_ROUTE_PATHNAME_HEADER = "x-stallorder-route-pathname";
export const MERCHANT_ROUTE_ORGANIZATION_HEADER = "x-stallorder-route-organization";
export const MERCHANT_ROUTE_STALL_HEADER = "x-stallorder-route-stall";

export type WorkspaceRouteContext = {
  organizationId: string | null;
  stallId: string | null;
};

export function buildMerchantRouteRequestHeaders(
  source: Headers,
  pathname: string,
  queryOrganizationIds: readonly string[],
  queryStallIds: readonly string[],
) {
  const headers = new Headers(source);
  headers.set(MERCHANT_ROUTE_PATHNAME_HEADER, pathname);

  const organizationId = singleQueryValue(queryOrganizationIds);
  overwriteScopeHeader(headers, MERCHANT_ROUTE_ORGANIZATION_HEADER, organizationId);

  // An ambiguous organization cannot safely be narrowed by a separate stall query.
  const stallId = queryOrganizationIds.length > 1 ? null : singleQueryValue(queryStallIds);
  overwriteScopeHeader(headers, MERCHANT_ROUTE_STALL_HEADER, stallId);
  return headers;
}

function singleQueryValue(values: readonly string[]) {
  if (values.length !== 1) return null;
  return values[0]?.trim() || null;
}

function overwriteScopeHeader(headers: Headers, name: string, value: string | null) {
  if (value) headers.set(name, value);
  else headers.delete(name);
}

function findRouteStall(
  workspaces: WorkspaceOrganization[],
  pathname: string,
): WorkspaceStall | undefined {
  return workspaces
    .flatMap((workspace) => workspace.stalls)
    .find((stall) => {
      const stallSettingsPath = `/merchant/stalls/${stall.id}`;
      return pathname === `/merchant/${stall.slug}`
        || pathname.startsWith(`/merchant/${stall.slug}/`)
        || pathname === stallSettingsPath
        || pathname.startsWith(`${stallSettingsPath}/`);
    });
}

export function resolveWorkspaceRouteContext(
  workspaces: WorkspaceOrganization[],
  pathname: string,
  queryOrganizationId: string | null,
  queryStallId: string | null = null,
): WorkspaceRouteContext {
  const routeStall = findRouteStall(workspaces, pathname);
  if (routeStall) {
    return {
      organizationId: routeStall.organizationId,
      stallId: routeStall.id,
    };
  }

  const organizationId = queryOrganizationId?.trim() || null;
  const stallId = queryStallId?.trim() || null;
  const queryOrganization = organizationId
    ? workspaces.find((workspace) => workspace.id === organizationId)
    : undefined;
  const queryStall = stallId
    ? workspaces.flatMap((workspace) => workspace.stalls)
      .find((stall) => stall.id === stallId)
    : undefined;

  if ((organizationId && !queryOrganization) || (stallId && !queryStall)) {
    return { organizationId: null, stallId: null };
  }
  if (queryOrganization && queryStall && queryStall.organizationId !== queryOrganization.id) {
    return { organizationId: null, stallId: null };
  }
  if (queryStall) {
    return {
      organizationId: queryStall.organizationId,
      stallId: queryStall.id,
    };
  }

  return {
    organizationId: queryOrganization?.id ?? null,
    stallId: null,
  };
}
