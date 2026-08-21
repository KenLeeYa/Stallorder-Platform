import { describe, expect, it } from "vitest";
import type { WorkspaceOrganization } from "@/lib/workspace";
import { resolveWorkspaceRouteContext } from "@/lib/workspace-route-context";

function workspace(
  organizationId: string,
  stallId: string,
  stallSlug: string,
): WorkspaceOrganization {
  return {
    id: organizationId,
    name: organizationId,
    businessName: organizationId,
    slug: organizationId,
    status: "ACTIVE",
    defaultCurrency: "TWD",
    merchantSetupState: "COMPLETED",
    merchantSetupStallId: stallId,
    roles: ["ORGANIZATION_OWNER"],
    canUseAllStalls: true,
    stalls: [{
      id: stallId,
      organizationId,
      name: stallId,
      slug: stallSlug,
      code: stallId,
      businessStatus: "OPEN",
      orderingEnabled: true,
      isActive: true,
      roles: ["ORGANIZATION_OWNER"],
    }],
  };
}

const workspaces = [
  workspace("organization-a", "stall-a", "alpha"),
  workspace("organization-b", "stall-b", "beta"),
];

describe("resolveWorkspaceRouteContext", () => {
  it.each([
    "/merchant/stalls/stall-b",
    "/merchant/stalls/stall-b/menu",
    "/merchant/stalls/stall-b/settings/ordering",
  ])("uses the stall id from an id-based merchant route: %s", (pathname) => {
    const context = resolveWorkspaceRouteContext(workspaces, pathname, null);

    expect(context.stallId).toBe("stall-b");
    expect(context.organizationId).toBe("organization-b");
  });

  it("keeps the path-derived organization ahead of a stale organization query", () => {
    const context = resolveWorkspaceRouteContext(
      workspaces,
      "/merchant/stalls/stall-b/settings",
      "organization-a",
    );

    expect(context.stallId).toBe("stall-b");
    expect(context.organizationId).toBe("organization-b");
  });

  it("uses the organization query on an aggregate merchant route", () => {
    const context = resolveWorkspaceRouteContext(
      workspaces,
      "/merchant/stalls",
      "organization-a",
    );

    expect(context.stallId).toBeNull();
    expect(context.organizationId).toBe("organization-a");
  });

  it.each([
    ["/merchant/beta", "stall-b"],
    ["/merchant/beta/reports", "stall-b"],
  ])("keeps existing slug route matching: %s", (pathname, stallId) => {
    const context = resolveWorkspaceRouteContext(workspaces, pathname, null);

    expect(context.stallId).toBe(stallId);
    expect(context.organizationId).toBe("organization-b");
  });
});
