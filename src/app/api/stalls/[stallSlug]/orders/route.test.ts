import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), create: vi.fn(), limit: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: () => true }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/staff-order-create", () => ({ createStaffOrder: mocks.create, StaffOrderCreateError: class extends Error {} }));
vi.mock("@/lib/orders", () => ({ activeOrderStatuses: [], staffOrderSelect: {}, serializeStaffOrder: (order: unknown) => order }));
vi.mock("@/server/billing/entitlement-service", () => ({ entitlementService: { assertLimitAvailable: mocks.limit } }));
import { POST } from "./route";
const actor = "66666666-6666-4666-8666-666666666666";
const context = { params: Promise.resolve({ stallSlug: "owned" }) };
const request = (expectedActor?: string) => new Request("http://local/api/stalls/owned/orders", { method: "POST", headers: { "Content-Type": "application/json", ...(expectedActor === undefined ? {} : { "x-stallorder-actor-id": expectedActor }) }, body: JSON.stringify({ fulfillmentType: "TAKEOUT", paymentTiming: "PAY_LATER", idempotencyKey: actor, items: [{ productId: actor, quantity: 1 }] }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ ok: true, stall: { organizationId: "org", id: "stall" }, principal: { user: { id: actor } }, roles: ["STAFF"], requestId: "req" });
  mocks.create.mockResolvedValue({ idempotent: false, order: { id: "order", items: [] } });
});
it.each([["invalid", 400], ["77777777-7777-4777-8777-777777777777", 403]])("rejects supplied actor %s before quota or mutation", async (identity, status) => {
  expect((await POST(request(String(identity)), context)).status).toBe(status);
  expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
});
it.each([actor, undefined])("retains authorized matching and absent-header clients: %s", async identity => {
  expect((await POST(request(identity), context)).status).toBe(201);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: actor, organizationId: "org", stallId: "stall" }));
});
