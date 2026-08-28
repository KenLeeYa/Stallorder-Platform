import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  applyCommand: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeOrganizationApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({ readJson: vi.fn(async (request: Request) => ({ data: await request.json() })) }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/workforce/workforce-service", () => ({
  WorkforceOperationError: class WorkforceOperationError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  applyWorkforceManagerCommand: mocks.applyCommand,
  getWorkforceDashboard: mocks.getDashboard,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const profileId = "55555555-5555-4555-8555-555555555551";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, requestId: "request-1", principal: { user: { id: profileId } } });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.applyCommand.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222" });
  mocks.getDashboard.mockResolvedValue({ payrollPreview: [], schedules: [], leaveRequests: [] });
});

describe("workforce manager API", () => {
  it("requires CSRF for wage and payroll changes", async () => {
    mocks.validateCsrf.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(commandRequest(validWage()), { params: Promise.resolve({ organizationId }) });
    expect(response.status).toBe(403);
    expect(mocks.applyCommand).not.toHaveBeenCalled();
  });

  it("scopes a valid wage rate to the authorized organization and audits it", async () => {
    const route = await import("./route");
    const response = await route.POST(commandRequest(validWage()), { params: Promise.resolve({ organizationId }) });
    expect(response.status).toBe(200);
    expect(mocks.applyCommand).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      actorProfileId: profileId,
      command: expect.objectContaining({ operation: "SET_WAGE_RATE", hourlyRate: 210 }),
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "WORKFORCE_SET_WAGE_RATE",
      outcome: "SUCCESS",
    }));
  });

  it("returns a conflict when payroll still has a missing wage rate", async () => {
    const service = await import("@/server/workforce/workforce-service");
    mocks.applyCommand.mockRejectedValueOnce(new service.WorkforceOperationError("WORKFORCE_WAGE_RATE_MISSING"));
    const route = await import("./route");
    const response = await route.POST(commandRequest({
      operation: "GENERATE_PAYROLL",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-29",
    }), { params: Promise.resolve({ organizationId }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "仍有工時缺少有效時薪，請先補齊再產生薪資單。" });
  });
});

function validWage() {
  return {
    operation: "SET_WAGE_RATE",
    profileId: "33333333-3333-4333-8333-333333333333",
    stallId: "44444444-4444-4444-8444-444444444444",
    hourlyRate: 210,
    effectiveFrom: "2026-08-01",
  };
}

function commandRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/workforce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
