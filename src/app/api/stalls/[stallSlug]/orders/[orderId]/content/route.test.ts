import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  edit: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/staff-order-edit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/staff-order-edit")>();
  return { ...original, editStaffOrderItems: mocks.edit };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "55555555-5555-4555-8555-555555555555" } },
    stall: { id: stallId, organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.readJson.mockResolvedValue({
    data: { items: [{ kind: "EXISTING", itemId, quantity: 2 }] },
  });
  mocks.edit.mockResolvedValue({
    order: { id: orderId, orderNo: "A001" },
    before: { subtotal: 100, total: 100, items: [] },
    after: { subtotal: 200, total: 200, items: [] },
  });
});

async function patch() {
  const route = await import("./route");
  return route.PATCH(
    new Request("https://example.test/api/stalls/demo/orders/order/content", { method: "PATCH" }),
    { params: Promise.resolve({ stallSlug: "demo", orderId }) },
  );
}

describe("staff order content edit route", () => {
  it("returns the replacement DTO and records before/after audit evidence", async () => {
    const response = await patch();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ order: { id: orderId } });
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ orderId, stallId, organizationId }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "STAFF_ORDER_ITEMS_EDITED",
      before: expect.objectContaining({ subtotal: 100 }),
      after: expect.objectContaining({ subtotal: 200 }),
    }));
  });

  it("rejects malformed item commands before entering the transaction", async () => {
    mocks.readJson.mockResolvedValue({ data: { items: [] } });

    const response = await patch();

    expect(response.status).toBe(400);
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it("reports a conflict when production already started", async () => {
    const { StaffOrderEditError } = await import("@/lib/staff-order-edit");
    mocks.edit.mockRejectedValue(new StaffOrderEditError("ORDER_ALREADY_STARTED"));

    const response = await patch();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "ORDER_ALREADY_STARTED" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "STAFF_ORDER_ITEMS_EDIT_FAILED",
      outcome: "FAILURE",
      metadata: { reason: "ORDER_ALREADY_STARTED" },
    }));
  });
});
