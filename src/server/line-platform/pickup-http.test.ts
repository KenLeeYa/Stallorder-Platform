import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), csrf: vi.fn(), rate: vi.fn(), audit: vi.fn(),
  runtime: vi.fn(), preview: vi.fn(), redeem: vi.fn(), manage: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.csrf }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("./pickup-service", async (original) => ({ ...await original<object>(),
  requirePickupRuntime: mocks.runtime, previewPlatformPickup: mocks.preview,
  redeemPlatformPickup: mocks.redeem, managePlatformPickup: mocks.manage }));
import { handlePickupStaffCommand } from "./pickup-http";

const stallId = "22222222-2222-4222-8222-222222222222";
const actorId = "44444444-4444-4444-8444-444444444444";
const token = `qidaigo:pickup:v1:${"a".repeat(43)}`;
const credential = { kind: "QR", token };
const command = { credential, expectedVersion: 1, confirmedHandoff: true,
  idempotencyKey: "55555555-5555-4555-8555-555555555555" };
function request(body: unknown) {
  return new Request("https://pickup.test/api/line-platform/pickup/merchant/redeem", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, requestId: "pickup-test", stall: {
    id: stallId, organizationId: "11111111-1111-4111-8111-111111111111" }, principal: { user: { id: actorId } } });
  mocks.csrf.mockReturnValue(true);
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.redeem.mockResolvedValue({ alreadyRedeemed: false });
  mocks.preview.mockResolvedValue({ canRedeem: true });
});

describe("staff pickup HTTP authorization boundary", () => {
  it("requires real checkout permission and never trusts a client stall identifier", async () => {
    const response = await handlePickupStaffCommand(request({ ...command, stallId: "other" }), "merchant", "redeem");
    expect(response.status).toBe(400);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), "merchant", "CHECKOUT_ORDERS");
    expect(mocks.redeem).not.toHaveBeenCalled();
  });
  it("blocks unauthorized and missing-CSRF requests before a handoff", async () => {
    mocks.authorize.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await handlePickupStaffCommand(request(command), "merchant", "redeem")).status).toBe(403);
    mocks.csrf.mockReturnValue(false);
    expect((await handlePickupStaffCommand(request(command), "merchant", "redeem")).status).toBe(403);
    expect(mocks.redeem).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it("rate limits before resolving scanned credentials", async () => {
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 12 });
    const response = await handlePickupStaffCommand(request(credential), "merchant", "preview");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("rejects implicit confirmation and never records the scanned secret in rejection audit", async () => {
    const response = await handlePickupStaffCommand(request({ ...command, confirmedHandoff: false }), "merchant", "redeem");
    expect(response.status).toBe(400);
    expect(mocks.redeem).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(token);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: {
      operation: "redeem", code: "PICKUP_INPUT_INVALID" } }));
  });
  it("keeps preview separate and passes only the authorized staff and stall to confirmation", async () => {
    const preview = await handlePickupStaffCommand(request(credential), "merchant", "preview");
    expect(preview.status).toBe(200);
    expect(mocks.redeem).not.toHaveBeenCalled();
    const response = await handlePickupStaffCommand(request(command), "merchant", "redeem");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.redeem).toHaveBeenCalledWith(stallId, actorId, command);
  });
});
