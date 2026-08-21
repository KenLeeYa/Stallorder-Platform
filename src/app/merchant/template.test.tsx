import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceOrganization } from "@/lib/workspace";
import {
  MERCHANT_ROUTE_ORGANIZATION_HEADER,
  MERCHANT_ROUTE_PATHNAME_HEADER,
  MERCHANT_ROUTE_STALL_HEADER,
} from "@/lib/workspace-route-context";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  merchantWorkspaceHeader: vi.fn(),
  requireWorkspacePage: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/components/merchant-workspace-header", () => ({
  MerchantWorkspaceHeader: mocks.merchantWorkspaceHeader,
}));
vi.mock("@/lib/workspace", () => ({
  requireWorkspacePage: mocks.requireWorkspacePage,
}));

import MerchantTemplate from "./template";

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

function requestHeaders(
  pathname: string,
  organizationId: string | null = null,
  stallId: string | null = null,
) {
  const requestHeaders = new Headers({
    [MERCHANT_ROUTE_PATHNAME_HEADER]: pathname,
  });
  if (organizationId) {
    requestHeaders.set(MERCHANT_ROUTE_ORGANIZATION_HEADER, organizationId);
  }
  if (stallId) {
    requestHeaders.set(MERCHANT_ROUTE_STALL_HEADER, stallId);
  }
  return requestHeaders;
}

async function renderTemplate() {
  const element = await MerchantTemplate({ children: <main>child</main> });
  renderToStaticMarkup(element);
}

describe("MerchantTemplate route context boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.headers.mockResolvedValue(requestHeaders("/merchant"));
    mocks.merchantWorkspaceHeader.mockImplementation(() => null);
    mocks.requireWorkspacePage.mockResolvedValue({
      principal: { user: { displayName: "Merchant User" } },
      workspaces,
    });
  });

  it("uses the route-owned organization in a multi-organization workspace", async () => {
    mocks.headers.mockResolvedValue(requestHeaders(
      "/merchant/stalls/stall-b/settings",
      "organization-a",
      "stall-a",
    ));

    await renderTemplate();

    expect(mocks.merchantWorkspaceHeader.mock.calls[0]?.[0]).toMatchObject({
      displayName: "Merchant User",
      workspaces,
      routeContext: {
        organizationId: "organization-b",
        stallId: "stall-b",
      },
    });
  });

  it("uses an authorized query stall on an aggregate route", async () => {
    mocks.headers.mockResolvedValue(requestHeaders(
      "/merchant/localization",
      "organization-b",
      "stall-b",
    ));

    await renderTemplate();

    expect(mocks.merchantWorkspaceHeader.mock.calls[0]?.[0]).toMatchObject({
      routeContext: { organizationId: "organization-b", stallId: "stall-b" },
    });
  });

  it("fails closed when query organization and stall scopes disagree", async () => {
    mocks.headers.mockResolvedValue(requestHeaders(
      "/merchant/localization",
      "organization-a",
      "stall-b",
    ));

    await renderTemplate();

    expect(mocks.merchantWorkspaceHeader.mock.calls[0]?.[0]).toMatchObject({
      routeContext: { organizationId: null, stallId: null },
    });
  });

  it("keeps an unscoped multi-organization route explicitly null", async () => {
    mocks.headers.mockResolvedValue(requestHeaders("/merchant/stalls"));

    await renderTemplate();

    expect(mocks.merchantWorkspaceHeader.mock.calls[0]?.[0]).toMatchObject({
      routeContext: { organizationId: null, stallId: null },
    });
  });

  it("does not forward an unauthorized organization or stall from invalid route context", async () => {
    mocks.headers.mockResolvedValue(requestHeaders(
      "/merchant/stalls/stall-outsider/settings",
      "organization-outsider",
    ));

    await renderTemplate();

    expect(mocks.merchantWorkspaceHeader.mock.calls[0]?.[0]).toMatchObject({
      routeContext: { organizationId: null, stallId: null },
    });
  });

  it("does not render workspace context when the authentication boundary rejects", async () => {
    const unauthenticated = new Error("NEXT_REDIRECT:/login");
    mocks.requireWorkspacePage.mockRejectedValue(unauthenticated);

    await expect(renderTemplate()).rejects.toBe(unauthenticated);

    expect(mocks.merchantWorkspaceHeader).not.toHaveBeenCalled();
  });
});
