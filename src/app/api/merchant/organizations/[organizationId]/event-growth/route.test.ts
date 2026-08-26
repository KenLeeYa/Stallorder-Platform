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
vi.mock("@/server/event-growth/event-growth-service", () => ({
  EventGrowthOperationError: class EventGrowthOperationError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  getEventGrowthDashboard: mocks.getDashboard,
  applyEventGrowthCommand: mocks.applyCommand,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, requestId: "request-1", principal: { user: { id: "55555555-5555-4555-8555-555555555551" } } });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.applyCommand.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
  mocks.getDashboard.mockResolvedValue({ events: [], campaigns: [], expenses: [], summary: {}, attributionCaptureEnabled: false });
});

describe("Event Growth merchant API", () => {
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
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "EVENT_GROWTH_CREATE_CAMPAIGN", outcome: "SUCCESS" }));
  });
});

function validCampaign() {
  return { operation: "CREATE_CAMPAIGN", marketEventId: eventId, name: "夏日市集 LINE", source: "LINE", medium: "QR", campaignCode: "SUMMER-2026", startsAt: "2026-09-01T00:00:00.000+08:00", endsAt: "2026-09-03T23:59:59.000+08:00" };
}

function commandRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/event-growth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
