import { beforeEach, expect, it, vi } from "vitest";
const actor = "66666666-6666-4666-8666-666666666666";
const key = "77777777-7777-4777-8777-777777777777";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/staff-order-create", () => ({ findStaffOrderRecovery: mocks.lookup }));
vi.mock("@/lib/orders", () => ({ serializeStaffOrder: (order: unknown) => order }));
import { GET } from "./route";
const context = { params: Promise.resolve({ stallSlug: "owned" }) };
const request = (actorProfileId = actor, idempotencyKey = key) => new Request(`http://local/api/stalls/owned/orders/recovery?actorProfileId=${actorProfileId}&idempotencyKey=${idempotencyKey}`);
beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ ok: true, stall: { organizationId: "org", id: "stall" }, principal: { user: { id: actor } }, requestId: "req" }); });
it("recovers only the original authenticated actor within server-resolved scope", async () => {
  mocks.lookup.mockResolvedValue({ id: "original" }); const response = await GET(request(), context);
  expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), "owned", "CREATE_ORDERS");
  expect(mocks.lookup).toHaveBeenCalledWith({ organizationId: "org", stallId: "stall", actorProfileId: actor, idempotencyKey: key });
  expect(await response.json()).toEqual({ status: "FOUND", order: { id: "original" } });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("absence remains UNKNOWN and authorizes no replacement", async () => {
  mocks.lookup.mockResolvedValue(null); expect(await (await GET(request(), context)).json()).toEqual({ status: "UNKNOWN" });
});
it("refuses a different actor or invalid key before looking up any order", async () => {
  expect((await GET(request("88888888-8888-4888-8888-888888888888"), context)).status).toBe(403);
  expect((await GET(request(actor, "bad"), context)).status).toBe(400);
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it.each([401,403,404])("preserves authorization denial %s", async (status) => {
  mocks.authorize.mockResolvedValue({ ok: false, response: new Response("{}", { status }) });
  expect((await GET(request(), context)).status).toBe(status); expect(mocks.lookup).not.toHaveBeenCalled();
});
