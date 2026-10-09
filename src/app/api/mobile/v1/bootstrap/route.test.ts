import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeMobileApiRequest = vi.fn();
const getMemberWorkspaceAccess = vi.fn();

vi.mock("@/server/mobile/authorization", () => ({ authorizeMobileApiRequest }));
vi.mock("@/lib/workspace", () => ({ getMemberWorkspaceAccess }));

beforeEach(() => {
  vi.clearAllMocks();
  authorizeMobileApiRequest.mockResolvedValue({
    ok: true,
    requestId: "11111111-1111-4111-8111-111111111111",
    principal: {
      sessionExpiresAt: new Date("2026-08-25T12:00:00.000Z"),
      user: {
        id: "22222222-2222-4222-8222-222222222222",
        email: "owner@example.test",
        displayName: "測試擁有者",
        platformRole: null,
      },
    },
    featureFlags: {
      localPilot: true,
      mobileApp: true,
      platformAdmin: false,
      push: false,
      offlinePos: false,
      directPrint: false,
    },
  });
  getMemberWorkspaceAccess.mockResolvedValue([{
    id: "33333333-3333-4333-8333-333333333333",
    name: "測試組織",
    businessName: "測試商家",
    slug: "test-org",
    status: "ACTIVE",
    defaultCurrency: "TWD",
    merchantSetupState: "COMPLETED",
    merchantSetupStallId: null,
    roles: ["ORGANIZATION_OWNER"],
    canUseAllStalls: true,
    stalls: [{
      id: "44444444-4444-4444-8444-444444444444",
      organizationId: "33333333-3333-4333-8333-333333333333",
      name: "測試攤位",
      slug: "test-stall",
      code: "TEST",
      businessStatus: "OPEN",
      orderingEnabled: true,
      isActive: true,
      kdsEnabled: true,
      roles: ["ORGANIZATION_OWNER"],
    }],
  }]);
});

describe("GET /api/mobile/v1/bootstrap", () => {
  it("derives navigation permissions from server roles", async () => {
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/mobile/v1/bootstrap"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.workspaces[0].permissions).toContain("MANAGE_ORGANIZATION");
    expect(body.workspaces[0].stalls[0].permissions).toContain("VIEW_ORDERS");
    expect(body.featureFlags.offlinePos).toBe(false);
    expect(body.featureFlags.localFixtureLab).toBe(false);
    expect(Object.keys(body.featureFlags).sort()).toEqual(["mobileApp","platformAdmin","push","offlinePos","directPrint","localFixtureLab"].sort());
    expect(body.featureFlags).not.toHaveProperty("localPilot");
  });

  it("does not enumerate merchant workspaces for a Platform Admin", async () => {
    authorizeMobileApiRequest.mockResolvedValue({
      ...(await authorizeMobileApiRequest()),
      principal: {
        sessionExpiresAt: new Date("2026-08-25T12:00:00.000Z"),
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "admin@example.test",
          displayName: "平台管理員",
          platformRole: "PLATFORM_ADMIN",
        },
      },
      featureFlags: {
      localPilot: true,
        mobileApp: true,
        platformAdmin: true,
        push: false,
        offlinePos: false,
        directPrint: false,
      },
    });
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/mobile/v1/bootstrap"));

    expect((await response.json()).workspaces).toEqual([]);
    expect(getMemberWorkspaceAccess).not.toHaveBeenCalled();
  });
});
