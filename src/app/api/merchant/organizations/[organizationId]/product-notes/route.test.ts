import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const firstGroupId = "aa100000-0000-4000-8000-000000000001";
const secondGroupId = "aa100000-0000-4000-8000-000000000002";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  entitlementErrorResponse: vi.fn(),
  transaction: vi.fn(),
  groupFindMany: vi.fn(),
  executeRaw: vi.fn(),
  getGroups: vi.fn(),
  getReusableNotes: vi.fn(),
  invalidatePublicMenus: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeOrganizationApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/public-menu", () => ({ invalidatePublicMenus: mocks.invalidatePublicMenus }));
vi.mock("@/lib/product-note-data", () => ({
  getOrganizationProductNotes: mocks.getGroups,
  getOrganizationReusableProductNotes: mocks.getReusableNotes,
}));
vi.mock("@/server/billing/entitlement-http", () => ({
  entitlementErrorResponse: mocks.entitlementErrorResponse,
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: { assertFeatureEnabled: mocks.assertFeatureEnabled },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-id",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    workspace: { stalls: [{ id: "22222222-2222-4222-8222-222222222222" }] },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.assertFeatureEnabled.mockResolvedValue({ featureCode: "MODIFIERS" });
  mocks.entitlementErrorResponse.mockReturnValue(null);
  mocks.groupFindMany.mockResolvedValue([{ id: firstGroupId }, { id: secondGroupId }]);
  mocks.executeRaw.mockResolvedValueOnce(2).mockResolvedValueOnce(4);
  mocks.getGroups.mockResolvedValue([]);
  mocks.getReusableNotes.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (operation) => operation({
    productNoteGroup: { findMany: mocks.groupFindMany },
    $executeRaw: mocks.executeRaw,
  }));
});

describe("product note ordering API", () => {
  it("bulk-updates groups and every public product assignment in one transaction", async () => {
    mocks.readJson.mockResolvedValue({
      data: {
        operation: "REORDER_NOTE_GROUPS",
        noteGroupIds: [secondGroupId, firstGroupId],
      },
    });
    const route = await import("./route");

    const response = await route.POST(new Request(
      `https://example.test/api/merchant/organizations/${organizationId}/product-notes`,
      { method: "POST", body: "{}" },
    ), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(200);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(sqlText(mocks.executeRaw.mock.calls[0]?.[0])).toContain("update public.product_note_groups");
    expect(sqlText(mocks.executeRaw.mock.calls[1]?.[0])).toContain("update public.product_note_group_assignments");
    expect(mocks.invalidatePublicMenus).toHaveBeenCalledWith(["22222222-2222-4222-8222-222222222222"]);
  });

  it("rejects a stale ID set before writing sort orders", async () => {
    mocks.groupFindMany.mockResolvedValue([{ id: firstGroupId }]);
    mocks.readJson.mockResolvedValue({
      data: {
        operation: "REORDER_NOTE_GROUPS",
        noteGroupIds: [secondGroupId, firstGroupId],
      },
    });
    const route = await import("./route");

    const response = await route.POST(new Request(
      `https://example.test/api/merchant/organizations/${organizationId}/product-notes`,
      { method: "POST", body: "{}" },
    ), { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(409);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });
});

function sqlText(query: unknown) {
  if (!query || typeof query !== "object" || !("strings" in query)) return "";
  return Array.from((query as { strings: readonly string[] }).strings).join("?");
}
