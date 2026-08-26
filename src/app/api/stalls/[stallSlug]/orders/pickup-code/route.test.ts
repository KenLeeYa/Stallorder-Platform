import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  rateLimit: vi.fn(),
  findCandidates: vi.fn(),
  verify: vi.fn(),
  findOrder: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findFirst: mocks.findOrder } } }));
vi.mock("@/lib/orders", () => ({
  staffOrderSelect: { id: true },
  serializeStaffOrder: (order: unknown) => order,
}));
vi.mock("@/server/orders/pickup-verification-service", () => ({
  findReadyPickupOrdersByCode: mocks.findCandidates,
  verifyReadyTakeoutOrder: mocks.verify,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "44444444-4444-4444-8444-444444444444" } },
    stall: { id: stallId, organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.readJson.mockResolvedValue({ data: { code: "738" } });
  mocks.rateLimit.mockResolvedValue({ allowed: true });
  mocks.findCandidates.mockResolvedValue([{ id: orderId }]);
  mocks.verify.mockResolvedValue({
    pickupVerifiedAt: new Date("2026-08-26T08:00:00.000Z"),
    pickupVerificationMethod: "CODE",
  });
  mocks.findOrder.mockResolvedValue({ id: orderId, orderNo: "A025" });
});

async function post() {
  const route = await import("./route");
  return route.POST(
    new Request("https://example.test/api/stalls/demo/orders/pickup-code", { method: "POST" }),
    { params: Promise.resolve({ stallSlug: "demo" }) },
  );
}

describe("pickup-code quick checkout route", () => {
  it("verifies the unique ready order and returns its checkout DTO", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ order: { id: orderId } });
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      stallId,
      code: "738",
      verificationMethod: "CODE",
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "PICKUP_CODE_QUICK_CHECKOUT_LOADED",
      entityId: orderId,
      outcome: "SUCCESS",
    }));
  });

  it("fails closed when the short code matches multiple active orders", async () => {
    mocks.findCandidates.mockResolvedValue([{ id: orderId }, { id: "other-order" }]);

    const response = await post();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "PICKUP_CODE_AMBIGUOUS" });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("rejects malformed codes before querying orders", async () => {
    mocks.readJson.mockResolvedValue({ data: { code: "12A" } });

    const response = await post();

    expect(response.status).toBe(400);
    expect(mocks.findCandidates).not.toHaveBeenCalled();
  });
});
