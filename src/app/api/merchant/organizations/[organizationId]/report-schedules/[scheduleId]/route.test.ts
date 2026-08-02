import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  findSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  archiveSchedule: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reportSchedule: {
      findFirst: mocks.findSchedule,
      update: mocks.updateSchedule,
      updateMany: mocks.archiveSchedule,
    },
  },
}));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/billing/entitlement-http", () => ({
  entitlementErrorResponse: vi.fn(() => null),
}));
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
    workspace: { stalls: [{ id: stallId, isActive: true }] },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.assertFeatureEnabled.mockResolvedValue(undefined);
  mocks.findSchedule.mockResolvedValue({
    id: scheduleId,
    organizationId,
    reportType: "DAILY_SALES",
    stallIds: [stallId],
    recipients: ["owner@example.com"],
    isEnabled: true,
  });
});

describe("更新報表排程 API 欄位錯誤", () => {
  it("把週報缺少寄送星期精確映射到 dayOfWeek", async () => {
    const route = await import("./route");
    const response = await route.PATCH(scheduleRequest(validSchedule({
      reportType: "WEEKLY_SALES",
      dayOfWeek: null,
    })), { params: Promise.resolve({ organizationId, scheduleId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors).toEqual({ dayOfWeek: "週報必須指定寄送星期。" });
    expect(mocks.findSchedule).not.toHaveBeenCalled();
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });

  it("把非週報夾帶寄送星期精確映射到 dayOfWeek", async () => {
    const route = await import("./route");
    const response = await route.PATCH(scheduleRequest(validSchedule({ dayOfWeek: 1 })), {
      params: Promise.resolve({ organizationId, scheduleId }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors).toEqual({ dayOfWeek: "非週報不可指定寄送星期。" });
    expect(mocks.findSchedule).not.toHaveBeenCalled();
  });

  it("把未授權攤位精確映射到 stallIds", async () => {
    const route = await import("./route");
    const response = await route.PATCH(scheduleRequest(validSchedule({
      stallIds: [unauthorizedStallId],
    })), { params: Promise.resolve({ organizationId, scheduleId }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "攤位範圍包含未授權資源。",
      fieldErrors: { stallIds: "攤位範圍包含未授權資源。" },
    });
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
  });
});

function validSchedule(overrides: Record<string, unknown> = {}) {
  return {
    name: "每日銷售日報",
    reportType: "DAILY_SALES",
    recipients: ["owner@example.com"],
    stallIds: [stallId],
    timezone: "Asia/Taipei",
    sendHour: 8,
    sendMinute: 0,
    dayOfWeek: null,
    isEnabled: true,
    ...overrides,
  };
}

function scheduleRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/report-schedules/${scheduleId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
