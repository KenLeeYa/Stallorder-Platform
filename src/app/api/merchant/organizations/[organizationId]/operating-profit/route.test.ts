import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  createExpense: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeOrganizationApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({ readJson: vi.fn(async (request: Request) => ({ data: await request.json() })) }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/finance/operating-profit-service", () => ({
  OperatingProfitError: class OperatingProfitError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  createOperatingExpense: mocks.createExpense,
  getOperatingProfitDashboard: mocks.getDashboard,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const activeStallId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    workspace: {
      stalls: [
        { id: activeStallId, isActive: true },
        { id: "33333333-3333-4333-8333-333333333333", isActive: false },
      ],
    },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.createExpense.mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
  mocks.getDashboard.mockResolvedValue({ summary: {}, expenses: [] });
});

describe("operating profit API", () => {
  it("uses only authorized active stalls for report queries", async () => {
    const route = await import("./route");
    const response = await route.GET(new Request(
      `https://example.test/api/merchant/organizations/${organizationId}/operating-profit?dateFrom=2026-08-01&dateTo=2026-08-29`,
    ), { params: Promise.resolve({ organizationId }) });
    expect(response.status).toBe(200);
    expect(mocks.getDashboard).toHaveBeenCalledWith({
      organizationId,
      stallIds: [activeStallId],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-29",
    });
  });

  it("creates and audits an operating expense", async () => {
    const route = await import("./route");
    const response = await route.POST(new Request(
      `https://example.test/api/merchant/organizations/${organizationId}/operating-profit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "CREATE_EXPENSE",
          stallId: activeStallId,
          expenseDate: "2026-08-29",
          category: "UTILITIES",
          amount: 3500,
          description: "本月電費",
        }),
      },
    ), { params: Promise.resolve({ organizationId }) });
    expect(response.status).toBe(201);
    expect(mocks.createExpense).toHaveBeenCalledWith(expect.objectContaining({ organizationId }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "OPERATING_EXPENSE_CREATED",
      outcome: "SUCCESS",
    }));
  });
});
