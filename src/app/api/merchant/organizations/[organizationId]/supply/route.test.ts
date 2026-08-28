import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  getSupplyDashboard: vi.fn(),
  applySupplyCommand: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeOrganizationApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/supply-lite/supply-service", () => ({
  SupplyOperationError: class SupplyOperationError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  getSupplyDashboard: mocks.getSupplyDashboard,
  applySupplyCommand: mocks.applySupplyCommand,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "44444444-4444-4444-8444-444444444444";

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
  mocks.applySupplyCommand.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222" });
  mocks.getSupplyDashboard.mockResolvedValue({ ingredients: [], locations: [], balances: [], products: [], recipeComponents: [], recentMovements: [] });
});

describe("Supply Lite merchant API", () => {
  it("requires CSRF before posting an inventory command", async () => {
    mocks.validateCsrf.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(commandRequest({
      operation: "CREATE_INGREDIENT",
      code: "CHICKEN",
      name: "雞腿",
      baseUom: "G",
      lowStockThresholdMicros: 0,
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(403);
    expect(mocks.applySupplyCommand).not.toHaveBeenCalled();
  });

  it("returns field-level validation feedback", async () => {
    const route = await import("./route");
    const response = await route.POST(commandRequest({
      operation: "CREATE_INGREDIENT",
      code: "中",
      name: "",
      baseUom: "斤",
      lowStockThresholdMicros: -1,
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors.code).toMatch(/原料代碼/);
    expect(payload.fieldErrors.name).toMatch(/原料名稱/);
    expect(mocks.applySupplyCommand).not.toHaveBeenCalled();
  });

  it("scopes a valid command to the authorized organization and audits it", async () => {
    const route = await import("./route");
    const response = await route.POST(commandRequest({
      operation: "CREATE_INGREDIENT",
      code: "CHICKEN",
      name: "雞腿",
      baseUom: "G",
      lowStockThresholdMicros: 2_000_000,
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.applySupplyCommand).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      actorProfileId: "55555555-5555-4555-8555-555555555551",
      command: expect.objectContaining({ operation: "CREATE_INGREDIENT", code: "CHICKEN" }),
      accessScope: { canUseAllStalls: false, authorizedStallIds: [stallId] },
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      action: "SUPPLY_CREATE_INGREDIENT",
      outcome: "SUCCESS",
    }));
  });

  it("requests stall-scoped authorization and filters the dashboard", async () => {
    const route = await import("./route");
    const response = await route.GET(new Request(
      `https://example.test/api/merchant/organizations/${organizationId}/supply`,
    ), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      organizationId,
      "MANAGE_SHARED_PRODUCTS",
      true,
    );
    expect(mocks.getSupplyDashboard).toHaveBeenCalledWith({
      organizationId,
      accessScope: { canUseAllStalls: false, authorizedStallIds: [stallId] },
    });
  });

  it("maps idempotency conflicts without exposing internals", async () => {
    const service = await import("@/server/supply-lite/supply-service");
    mocks.applySupplyCommand.mockRejectedValueOnce(new service.SupplyOperationError("SUPPLY_IDEMPOTENCY_CONFLICT"));
    const route = await import("./route");
    const response = await route.POST(commandRequest({
      operation: "POST_MOVEMENT",
      ingredientId: "22222222-2222-4222-8222-222222222222",
      locationId: "33333333-3333-4333-8333-333333333333",
      movementType: "RECEIPT",
      quantityDeltaMicros: 1_000_000,
      unitCostMicros: 50_000,
      sourceType: "MANUAL_RECEIPT",
      sourceId: "receipt-1",
      idempotencyKey: "supply:receipt:stable-1",
      reason: "進貨",
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "此庫存操作代碼已被其他內容使用，請重新送出。" });
  });
});

function commandRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/supply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
