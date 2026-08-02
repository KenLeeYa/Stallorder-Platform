import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  createSchedule: vi.fn(),
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
  prisma: { reportSchedule: { create: mocks.createSchedule } },
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
});

describe("建立報表排程 API 欄位錯誤", () => {
  it("以繁中欄位錯誤回報空白與格式錯誤", async () => {
    const route = await import("./route");
    const response = await route.POST(scheduleRequest({
      name: " ",
      reportType: "DAILY_SALES",
      recipients: [],
      stallIds: [],
      timezone: "Invalid/Timezone",
      sendHour: null,
      sendMinute: null,
      dayOfWeek: null,
      isEnabled: true,
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors).toEqual(expect.objectContaining({
      name: expect.stringMatching(/[\u3400-\u9fff]/u),
      recipients: expect.stringMatching(/[\u3400-\u9fff]/u),
      stallIds: expect.stringMatching(/[\u3400-\u9fff]/u),
      timezone: expect.stringMatching(/[\u3400-\u9fff]/u),
      sendHour: expect.stringMatching(/[\u3400-\u9fff]/u),
      sendMinute: expect.stringMatching(/[\u3400-\u9fff]/u),
    }));
    expect(mocks.createSchedule).not.toHaveBeenCalled();
  });

  it("把未授權攤位精確映射到 stallIds", async () => {
    const route = await import("./route");
    const response = await route.POST(scheduleRequest(validSchedule({
      stallIds: [unauthorizedStallId],
    })), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "攤位範圍包含未授權資源。",
      fieldErrors: { stallIds: "攤位範圍包含未授權資源。" },
    });
    expect(mocks.createSchedule).not.toHaveBeenCalled();
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
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/report-schedules`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
