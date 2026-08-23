import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const paymentId = "44444444-4444-4444-8444-444444444444";
const paymentOptionId = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  verifyManagerAuthorization: vi.fn(),
  recordAuditEvent: vi.fn(),
  orderFindFirst: vi.fn(),
  orderFindMany: vi.fn(),
  paymentOptionFindFirst: vi.fn(),
  paymentOptionFindMany: vi.fn(),
  paymentUpdateMany: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderEventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/manager-authorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manager-authorization")>()),
  verifyManagerAuthorization: mocks.verifyManagerAuthorization,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findFirst: mocks.orderFindFirst, findMany: mocks.orderFindMany },
    paymentOption: { findFirst: mocks.paymentOptionFindFirst, findMany: mocks.paymentOptionFindMany },
    $transaction: mocks.transaction,
  },
}));

describe("completed order protected corrections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      ok: true,
      requestId: "request-1",
      stall: { id: stallId, organizationId, timezone: "Asia/Taipei" },
      principal: { user: { id: "66666666-6666-4666-8666-666666666666" } },
      roles: ["STAFF"],
    });
    mocks.validateCsrf.mockReturnValue(true);
    mocks.verifyManagerAuthorization.mockResolvedValue({ method: "SHARED_CODE" });
    mocks.orderFindFirst.mockResolvedValue({
      id: orderId,
      orderNo: "A023",
      status: "COMPLETED",
      paymentStatus: "PAID",
      payment: {
        id: paymentId,
        checkoutGroupId: null,
        paymentOptionId: "77777777-7777-4777-8777-777777777777",
        method: "CASH",
        methodLabel: "現金",
        cashShiftId: "88888888-8888-4888-8888-888888888888",
        amount: 150,
        status: "PAID",
      },
    });
    mocks.orderFindMany.mockResolvedValue([]);
    mocks.paymentOptionFindMany.mockResolvedValue([]);
    mocks.paymentOptionFindFirst.mockResolvedValue({ id: paymentOptionId, name: "LINE Pay", kind: "OTHER" });
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderEventCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => callback({
      payment: { updateMany: mocks.paymentUpdateMany },
      order: { updateMany: mocks.orderUpdateMany },
      orderEvent: { create: mocks.orderEventCreate },
      cashShift: { findFirst: vi.fn() },
    }));
  });

  it("rejects attempts to include product or quantity changes", async () => {
    const response = await patch({
      operation: "CHANGE_COMPLETED_PAYMENT",
      orderId,
      paymentOptionId,
      reason: "顧客改用 LINE Pay",
      managerAuthorizationCode: "2468",
      items: [{ id: "item-1", quantity: 99 }],
    });

    expect(response.status).toBe(400);
    expect(mocks.orderFindFirst).not.toHaveBeenCalled();
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
  });

  it("defaults history to the stall-local current day using terminal timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
    try {
      const route = await import("./route");
      const response = await route.GET(
        new Request("https://example.test/api/stalls/demo/completed-orders?status=ALL"),
        { params: Promise.resolve({ stallSlug: "demo" }) },
      );

      expect(response.status).toBe(200);
      expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { status: "COMPLETED", completedAt: { gte: new Date("2026-08-22T16:00:00Z"), lt: new Date("2026-08-23T16:00:00Z") } },
            { status: "CANCELLED", cancelledAt: { gte: new Date("2026-08-22T16:00:00Z"), lt: new Date("2026-08-23T16:00:00Z") } },
          ],
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes only the paid payment method and preserves order items and totals", async () => {
    const response = await patch({
      operation: "CHANGE_COMPLETED_PAYMENT",
      orderId,
      paymentOptionId,
      reason: "顧客改用 LINE Pay",
      managerAuthorizationCode: "2468",
    });

    expect(response.status).toBe(200);
    expect(mocks.verifyManagerAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      operation: "CHANGE_COMPLETED_PAYMENT",
      authorizationCode: "2468",
    }));
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: paymentId, orderId, status: "PAID" },
      data: {
        paymentOptionId,
        method: "OTHER",
        methodLabel: "LINE Pay",
        cashShiftId: null,
        cashReceived: null,
        changeAmount: null,
        reconciliationStatus: "PAYMENT_METHOD_CORRECTED",
      },
    });
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "COMPLETED_PAYMENT_METHOD_CHANGED",
      before: expect.objectContaining({ methodLabel: "現金" }),
      after: expect.objectContaining({ methodLabel: "LINE Pay", cashShiftId: null }),
    }));
  });
});

async function patch(body: unknown) {
  const route = await import("./route");
  return route.PATCH(
    new Request("https://example.test/api/stalls/demo/completed-orders", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ stallSlug: "demo" }) },
  );
}
