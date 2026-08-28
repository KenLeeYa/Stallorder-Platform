import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  cancelLeave: vi.fn(),
  createLeave: vi.fn(),
  getSnapshot: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({ readJson: vi.fn(async (request: Request) => ({ data: await request.json() })) }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/workforce/workforce-service", () => ({
  WorkforceOperationError: class WorkforceOperationError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  cancelEmployeeLeaveRequest: mocks.cancelLeave,
  createEmployeeLeaveRequest: mocks.createLeave,
  getEmployeeWorkforceSnapshot: mocks.getSnapshot,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    stall: {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
    },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.createLeave.mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
  mocks.cancelLeave.mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
  mocks.getSnapshot.mockResolvedValue({ schedules: [], leaveRequests: [] });
});

describe("employee workforce API", () => {
  it("always creates leave for the authenticated employee and stall", async () => {
    const route = await import("./route");
    const response = await route.POST(new Request("https://example.test/api/stalls/aming-chicken/workforce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "CREATE_LEAVE_REQUEST",
        leaveType: "DAY_OFF",
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        reason: "家庭行程",
      }),
    }), { params: Promise.resolve({ stallSlug: "aming-chicken" }) });
    expect(response.status).toBe(201);
    expect(mocks.createLeave).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "11111111-1111-4111-8111-111111111111",
      stallId: "22222222-2222-4222-8222-222222222222",
      profileId: "55555555-5555-4555-8555-555555555551",
    }));
  });

  it("cancels only through the authenticated employee scope", async () => {
    const route = await import("./route");
    const response = await route.POST(new Request("https://example.test/api/stalls/aming-chicken/workforce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "CANCEL_LEAVE_REQUEST",
        leaveRequestId: "66666666-6666-4666-8666-666666666666",
      }),
    }), { params: Promise.resolve({ stallSlug: "aming-chicken" }) });
    expect(response.status).toBe(201);
    expect(mocks.cancelLeave).toHaveBeenCalledWith(expect.objectContaining({
      stallId: "22222222-2222-4222-8222-222222222222",
      profileId: "55555555-5555-4555-8555-555555555551",
    }));
  });
});
