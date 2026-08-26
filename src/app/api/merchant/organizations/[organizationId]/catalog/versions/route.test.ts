import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  createCatalogDraft: vi.fn(),
  listCatalogVersions: vi.fn(),
  transitionCatalogVersion: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeOrganizationApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash") }));
vi.mock("@/server/catalog-versions/catalog-version-service", () => ({
  CatalogVersionOperationError: class CatalogVersionOperationError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  createCatalogDraft: mocks.createCatalogDraft,
  listCatalogVersions: mocks.listCatalogVersions,
  transitionCatalogVersion: mocks.transitionCatalogVersion,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.createCatalogDraft.mockResolvedValue({ id: versionId });
  mocks.transitionCatalogVersion.mockResolvedValue({ id: versionId });
  mocks.listCatalogVersions.mockResolvedValue([]);
});

describe("versioned catalog API", () => {
  it("requires CSRF before creating a draft", async () => {
    mocks.validateCsrf.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(commandRequest({ operation: "CREATE_DRAFT", name: "秋季菜單" }), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(403);
    expect(mocks.createCatalogDraft).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "CSRF_VALIDATION_FAILED",
      outcome: "DENIED",
    }));
  });

  it("creates a draft in the authorized organization and records the change", async () => {
    const route = await import("./route");
    const response = await route.POST(commandRequest({ operation: "CREATE_DRAFT", name: "秋季菜單" }), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.createCatalogDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      name: "秋季菜單",
      menuKey: "DEFAULT",
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "CATALOG_VERSION_DRAFT_CREATED",
      entityId: versionId,
      outcome: "SUCCESS",
    }));
  });

  it("returns field-level feedback for an invalid menu key", async () => {
    const route = await import("./route");
    const response = await route.POST(commandRequest({
      operation: "CREATE_DRAFT",
      name: "秋季菜單",
      menuKey: "中文代碼",
    }), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    const payload = await response.json() as { fieldErrors: Record<string, string> };
    expect(payload.fieldErrors.menuKey).toMatch(/菜單代碼/);
    expect(mocks.createCatalogDraft).not.toHaveBeenCalled();
  });

  it("maps a disabled HQ module to an explicit response", async () => {
    const service = await import("@/server/catalog-versions/catalog-version-service");
    mocks.listCatalogVersions.mockRejectedValueOnce(new service.CatalogVersionOperationError("HQ_MODULE_DISABLED"));
    const route = await import("./route");
    const response = await route.GET(new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog/versions`), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "總部菜單模組尚未對此組織開放。" });
  });
});

function commandRequest(body: unknown) {
  return new Request(`https://example.test/api/merchant/organizations/${organizationId}/catalog/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
