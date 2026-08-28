import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  findSchedule: vi.fn(),
  createTestReportDelivery: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeOrganizationApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/prisma", () => ({ prisma: { reportSchedule: { findFirst: mocks.findSchedule } } }));
vi.mock("@/lib/report-delivery", () => ({ createTestReportDelivery: mocks.createTestReportDelivery }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/billing/entitlement-http", () => ({ entitlementErrorResponse: vi.fn(() => null) }));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: { assertFeatureEnabled: mocks.assertFeatureEnabled },
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const unauthorizedStallId = "33333333-3333-4333-8333-333333333333";
const scheduleId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    authorizedStallIds: [stallId],
    workspace: { canUseAllStalls: false },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.assertFeatureEnabled.mockResolvedValue(undefined);
  mocks.createTestReportDelivery.mockResolvedValue({ status: "SIMULATED", deliveryId: "delivery-1" });
});

describe("測試報表排程 API 攤位授權", () => {
  it("拒絕寄送超出授權範圍的既有排程", async () => {
    mocks.findSchedule.mockResolvedValue({ stallIds: [unauthorizedStallId] });
    const route = await import("./route");
    const response = await route.POST(request(), { params: Promise.resolve({ organizationId, scheduleId }) });

    expect(response.status).toBe(403);
    expect(mocks.createTestReportDelivery).not.toHaveBeenCalled();
  });

  it("允許寄送完全位於授權範圍內的排程", async () => {
    mocks.findSchedule.mockResolvedValue({ stallIds: [stallId] });
    const route = await import("./route");
    const response = await route.POST(request(), { params: Promise.resolve({ organizationId, scheduleId }) });

    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request), organizationId, "MANAGE_REPORT_SCHEDULES", true,
    );
    expect(mocks.createTestReportDelivery).toHaveBeenCalledWith(scheduleId, organizationId);
  });
});

function request() {
  return new Request(
    `https://example.test/api/merchant/organizations/${organizationId}/report-schedules/${scheduleId}/test`,
    { method: "POST" },
  );
}
