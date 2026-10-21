import { beforeEach, describe, expect, it, vi } from "vitest";

const getMobileRequestPrincipal = vi.fn();
const recordAuditEvent = vi.fn();
const checkRateLimit = vi.fn();
const getMemberWorkspaceAccess = vi.fn();
const resolveMobileFeatureState = vi.fn();

vi.mock("@/lib/auth", () => ({ getMobileRequestPrincipal }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/workspace", () => ({ getMemberWorkspaceAccess }));
vi.mock("./feature-flags", () => ({ resolveMobileFeatureState }));

const principal = {
  sessionExpiresAt: new Date("2026-08-26T12:00:00.000Z"),
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.test",
    displayName: "測試擁有者",
    platformRole: null,
  },
};
const workspace = {
  id: "22222222-2222-4222-8222-222222222222",
  defaultCurrency: "TWD",
  roles: ["ORGANIZATION_OWNER"],
  stalls: [{
    id: "33333333-3333-4333-8333-333333333333",
    name: "測試攤位",
    slug: "test-stall",
    businessStatus: "OPEN",
    orderingEnabled: true,
    isActive: true,
    kdsEnabled: true,
    roles: ["ORGANIZATION_OWNER"],
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveMobileFeatureState.mockResolvedValue({
    mobileApp: true,
    platformAdmin: false,
    push: false,
    offlinePos: false,
    directPrint: false,
  });
  getMobileRequestPrincipal.mockResolvedValue(principal);
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  getMemberWorkspaceAccess.mockResolvedValue([workspace]);
  recordAuditEvent.mockResolvedValue(undefined);
});

describe("authorizeMobileStallRequest", () => {
  it("returns only a server-derived authorized stall scope", async () => {
    const { authorizeMobileStallRequest } = await import("./authorization");
    const result = await authorizeMobileStallRequest(
      new Request("https://example.test/api/mobile/v1/stalls/333/dashboard"),
      "33333333-3333-4333-8333-333333333333",
      "VIEW_REPORTS",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.id).toBe("22222222-2222-4222-8222-222222222222");
      expect(result.stall.id).toBe("33333333-3333-4333-8333-333333333333");
    }
  });

  it("rejects a Platform Admin merchant context without support-context design", async () => {
    getMobileRequestPrincipal.mockResolvedValue({
      ...principal,
      user: { ...principal.user, platformRole: "PLATFORM_ADMIN" },
    });
    resolveMobileFeatureState.mockResolvedValue({
      mobileApp: true,
      platformAdmin: true,
      push: false,
      offlinePos: false,
      directPrint: false,
    });
    const { authorizeMobileStallRequest } = await import("./authorization");
    const result = await authorizeMobileStallRequest(
      new Request("https://example.test/api/mobile/v1/stalls/333/dashboard"),
      "33333333-3333-4333-8333-333333333333",
      "VIEW_REPORTS",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
    expect(getMemberWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("rejects a role without the requested permission", async () => {
    getMemberWorkspaceAccess.mockResolvedValue([{
      ...workspace,
      roles: ["STAFF"],
      stalls: [{ ...workspace.stalls[0], roles: ["STAFF"] }],
    }]);
    const { authorizeMobileStallRequest } = await import("./authorization");
    const result = await authorizeMobileStallRequest(
      new Request("https://example.test/api/mobile/v1/stalls/333/dashboard"),
      "33333333-3333-4333-8333-333333333333",
      "VIEW_REPORTS",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});

describe("mobile unauthenticated boundaries",()=>{
  it.each([
    {localPilot:true,mobileApp:false,status:401},
    {localPilot:false,mobileApp:false,status:404},
    {localPilot:false,mobileApp:true,status:401},
  ])("returns $status with localPilot=$localPilot and mobileApp=$mobileApp",async({localPilot,mobileApp,status})=>{
    getMobileRequestPrincipal.mockResolvedValue(null);
    resolveMobileFeatureState.mockResolvedValue({localPilot,mobileApp,platformAdmin:false,push:false,offlinePos:false,directPrint:false});
    const {authorizeMobileStallRequest}=await import("./authorization");
    const result=await authorizeMobileStallRequest(new Request("http://127.0.0.1:3026/api/mobile/v1/stalls/333/orders",{headers:{authorization:"Bearer rejected",cookie:"stallorder_session=rejected"}}),"333","VIEW_ORDERS");
    expect(result.ok).toBe(false);if(!result.ok)expect(result.response.status).toBe(status);
    expect(checkRateLimit).not.toHaveBeenCalled();expect(getMemberWorkspaceAccess).not.toHaveBeenCalled();expect(recordAuditEvent).not.toHaveBeenCalled();
  });
  it("does not authorize an authenticated nonallowlisted principal",async()=>{
    resolveMobileFeatureState.mockResolvedValue({localPilot:true,mobileApp:false,platformAdmin:false,push:false,offlinePos:false,directPrint:false});
    const {authorizeMobileStallRequest}=await import("./authorization");const result=await authorizeMobileStallRequest(new Request("http://127.0.0.1:3026/api/mobile/v1/stalls/333/orders"),"333","VIEW_ORDERS");
    expect(result.ok).toBe(false);if(!result.ok)expect(result.response.status).toBe(404);expect(checkRateLimit).not.toHaveBeenCalled();expect(getMemberWorkspaceAccess).not.toHaveBeenCalled();
  });
});
