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
vi.mock("@/server/developer-platform/developer-service", () => ({
  DeveloperPlatformError: class DeveloperPlatformError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  getDeveloperPlatformDashboard: mocks.getDashboard,
  applyDeveloperCommand: mocks.applyCommand,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.applyCommand.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", oneTimeSecret: "secret" });
  mocks.getDashboard.mockResolvedValue({ apiClients: [], webhookEndpoints: [], recentDeliveries: [] });
});

describe("developer platform merchant API", () => {
  it("requires CSRF before issuing a credential", async () => {
    mocks.validateCsrf.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(commandRequest({ operation: "CREATE_API_KEY", name: "ERP", scopes: ["catalog:read"], stallIds: [], expiresAt: null }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(403);
    expect(mocks.applyCommand).not.toHaveBeenCalled();
  });

  it("returns the one-time secret only in the create response", async () => {
    const route = await import("./route");
    const response = await route.POST(commandRequest({ operation: "CREATE_API_KEY", name: "ERP", scopes: ["catalog:read"], stallIds: [], expiresAt: null }), { params: Promise.resolve({ organizationId }) });
    const payload = await response.json() as { oneTimeSecret: string; apiClients: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.oneTimeSecret).toBe("secret");
    expect(mocks.applyCommand).toHaveBeenCalledWith(expect.objectContaining({ organizationId }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "DEVELOPER_CREATE_API_KEY", outcome: "SUCCESS" }));
  });

  it("rejects a private webhook address with field feedback", async () => {
    const route = await import("./route");
    const response = await route.POST(commandRequest({ operation: "CREATE_WEBHOOK_ENDPOINT", name: "Local", url: "https://127.0.0.1/hook", eventTypes: ["ORDER_COMPLETED"] }), { params: Promise.resolve({ organizationId }) });
    const payload = await response.json() as { fieldErrors: Record<string, string> };

    expect(response.status).toBe(400);
    expect(payload.fieldErrors.url).toMatch(/Webhook/);
    expect(mocks.applyCommand).not.toHaveBeenCalled();
  });
});

function commandRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/developer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
