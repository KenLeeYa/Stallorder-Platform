import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  getDashboard: vi.fn(),
  applyCommand: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeOrganizationApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({ readJson: vi.fn(async (request: Request) => ({ data: await request.json() })) }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/growth/growth-service", () => ({
  GrowthOperationError: class GrowthOperationError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  getGrowthDashboard: mocks.getDashboard,
  applyGrowthCommand: mocks.applyCommand,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, requestId: "request-1", principal: { user: { id: "55555555-5555-4555-8555-555555555551" } } });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.applyCommand.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222" });
  mocks.getDashboard.mockResolvedValue({ campaigns: [], counts: {}, customerActivationLocked: true });
});

describe("Growth merchant API", () => {
  it("requires CSRF before creating a campaign", async () => {
    mocks.validateCsrf.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(commandRequest(validCampaign()), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(403);
    expect(mocks.applyCommand).not.toHaveBeenCalled();
  });

  it("creates a campaign in the authorized organization and audits it", async () => {
    const route = await import("./route");
    const response = await route.POST(commandRequest(validCampaign()), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.applyCommand).toHaveBeenCalledWith(expect.objectContaining({ organizationId }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "GROWTH_CREATE_COUPON_CAMPAIGN", outcome: "SUCCESS" }));
  });
});

function validCampaign() {
  return { operation: "CREATE_COUPON_CAMPAIGN", name: "開幕九折", discountType: "PERCENT", discountValue: 10, budgetAmount: 20000, perCustomerLimit: 1, minimumOrderAmount: 200, startsAt: "2026-09-01T00:00:00.000+08:00", endsAt: "2026-09-30T23:59:59.000+08:00", channels: ["QR"] };
}

function commandRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/growth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
