import { describe, expect, it } from "vitest";
import type { WorkspaceOrganization } from "@/lib/workspace";
import {
  buildMerchantRouteRequestHeaders,
  MERCHANT_ROUTE_ORGANIZATION_HEADER,
  MERCHANT_ROUTE_PATHNAME_HEADER,
  MERCHANT_ROUTE_STALL_HEADER,
  resolveWorkspaceRouteContext,
} from "./workspace-route-context";

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
      kdsEnabled: false,
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
    "/merchant/beta",
    "/merchant/beta/reports",
  ])("resolves an authorized stall route on the server: %s", (pathname) => {
    expect(resolveWorkspaceRouteContext(workspaces, pathname, null)).toEqual({
      organizationId: "organization-b",
      stallId: "stall-b",
    });
  });

  it("keeps path scope ahead of a stale organization query", () => {
    expect(resolveWorkspaceRouteContext(
      workspaces,
      "/merchant/stalls/stall-b/settings",
      "organization-a",
      "stall-a",
    )).toEqual({ organizationId: "organization-b", stallId: "stall-b" });
  });

  it("accepts an authorized organization on an aggregate route", () => {
    expect(resolveWorkspaceRouteContext(
      workspaces,
      "/merchant/stalls",
      "organization-a",
    )).toEqual({ organizationId: "organization-a", stallId: null });
  });

  it("accepts an authorized stall query on an aggregate route", () => {
    expect(resolveWorkspaceRouteContext(
      workspaces,
      "/merchant/localization",
      "organization-b",
      "stall-b",
    )).toEqual({ organizationId: "organization-b", stallId: "stall-b" });
  });

  it("derives the organization from an authorized stall query", () => {
    expect(resolveWorkspaceRouteContext(
      workspaces,
      "/merchant/localization",
      null,
      "stall-b",
    )).toEqual({ organizationId: "organization-b", stallId: "stall-b" });
  });

  it("fails closed when organization and stall query scopes do not match", () => {
    expect(resolveWorkspaceRouteContext(
      workspaces,
      "/merchant/localization",
      "organization-a",
      "stall-b",
    )).toEqual({ organizationId: null, stallId: null });
  });

  it("does not resolve an unauthorized stall query", () => {
    expect(resolveWorkspaceRouteContext(
      workspaces,
      "/merchant/localization",
      "organization-a",
      "stall-other",
    )).toEqual({ organizationId: null, stallId: null });
  });

  it.each([
    ["/merchant/stalls", "organization-other"],
    ["/merchant/stalls/stall-other/settings", null],
    ["/merchant/other-tenant", null],
  ])("does not resolve an unauthorized tenant scope: %s", (pathname, organizationId) => {
    expect(resolveWorkspaceRouteContext(workspaces, pathname, organizationId)).toEqual({
      organizationId: null,
      stallId: null,
    });
  });
});

describe("buildMerchantRouteRequestHeaders", () => {
  it("overwrites client-supplied route scope with the current request URL", () => {
    const incoming = new Headers({
      [MERCHANT_ROUTE_PATHNAME_HEADER]: "/merchant/other-tenant",
      [MERCHANT_ROUTE_ORGANIZATION_HEADER]: "organization-other",
      [MERCHANT_ROUTE_STALL_HEADER]: "stall-other",
    });

    const headers = buildMerchantRouteRequestHeaders(
      incoming,
      "/merchant/stalls/stall-a",
      ["organization-a"],
      ["stall-a"],
    );

    expect(headers.get(MERCHANT_ROUTE_PATHNAME_HEADER)).toBe("/merchant/stalls/stall-a");
    expect(headers.get(MERCHANT_ROUTE_ORGANIZATION_HEADER)).toBe("organization-a");
    expect(headers.get(MERCHANT_ROUTE_STALL_HEADER)).toBe("stall-a");
  });

  it("removes stale scope headers when the URL has no query scope", () => {
    const incoming = new Headers({
      [MERCHANT_ROUTE_ORGANIZATION_HEADER]: "organization-other",
      [MERCHANT_ROUTE_STALL_HEADER]: "stall-other",
    });

    const headers = buildMerchantRouteRequestHeaders(incoming, "/merchant/stalls", [], []);

    expect(headers.get(MERCHANT_ROUTE_ORGANIZATION_HEADER)).toBeNull();
    expect(headers.get(MERCHANT_ROUTE_STALL_HEADER)).toBeNull();
  });

  it("keeps a single authorized organization as aggregate scope when stall query has multiple values", () => {
    const incoming = new Headers({
      [MERCHANT_ROUTE_STALL_HEADER]: "stall-other",
    });

    const headers = buildMerchantRouteRequestHeaders(
      incoming,
      "/merchant/localization",
      ["organization-a"],
      ["stall-a", "stall-b"],
    );

    expect(headers.get(MERCHANT_ROUTE_ORGANIZATION_HEADER)).toBe("organization-a");
    expect(headers.get(MERCHANT_ROUTE_STALL_HEADER)).toBeNull();
  });

  it("fails closed when organization query has multiple values, even with a single stall query", () => {
    const incoming = new Headers({
      [MERCHANT_ROUTE_ORGANIZATION_HEADER]: "organization-other",
    });

    const headers = buildMerchantRouteRequestHeaders(
      incoming,
      "/merchant/localization",
      ["organization-a", "organization-b"],
      ["stall-a"],
    );

    expect(headers.get(MERCHANT_ROUTE_ORGANIZATION_HEADER)).toBeNull();
    expect(headers.get(MERCHANT_ROUTE_STALL_HEADER)).toBeNull();
  });
});
