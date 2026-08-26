import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  findMany: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/server/developer-platform/public-api-auth", () => ({ authorizePublicApiRequest: mocks.authorize }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findMany: mocks.findMany } } }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({ hashClientIp: vi.fn(() => "ip-hash"), createRequestId: vi.fn(() => "request-1") }));

const organizationId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, client: { id: "22222222-2222-4222-8222-222222222222" }, requestId: "request-1" });
  mocks.findMany.mockResolvedValue([
    { id: "33333333-3333-4333-8333-333333333333", name: "香酥雞排", description: "", kind: "SINGLE", defaultPrice: 95, updatedAt: new Date("2026-08-26T00:00:00.000Z") },
  ]);
});

describe("Public API v1 catalog", () => {
  it("requires a scoped API key before reading catalog data", async () => {
    mocks.authorize.mockResolvedValueOnce({ ok: false, response: new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }) });
    const route = await import("./route");
    const response = await route.GET(new Request(`https://example.test/api/v1/organizations/${organizationId}/catalog`), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns a bounded, versioned, secret-free page", async () => {
    const route = await import("./route");
    const response = await route.GET(new Request(`https://example.test/api/v1/organizations/${organizationId}/catalog?limit=20`), { params: Promise.resolve({ organizationId }) });
    const payload = await response.json() as { data: Array<Record<string, unknown>>; meta: { apiVersion: string; nextCursor: string | null } };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-stallorder-api-version")).toBe("2026-08-26");
    expect(payload.meta).toMatchObject({ apiVersion: "2026-08-26", nextCursor: null });
    expect(payload.data[0]).toMatchObject({ name: "香酥雞排", price: { amount: 95, currency: "TWD" } });
    expect(JSON.stringify(payload)).not.toMatch(/hash|secret|password/i);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ organizationId, requiredScope: "catalog:read" }));
  });
});
