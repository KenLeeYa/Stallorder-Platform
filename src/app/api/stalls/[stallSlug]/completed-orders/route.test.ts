import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const paymentId = "44444444-4444-4444-8444-444444444444";
const paymentOptionId = "55555555-5555-4555-8555-555555555555";
const cashShiftId = "88888888-8888-4888-8888-888888888888";
const orderEventId = "99999999-9999-4999-8999-999999999999";

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
  cashShiftFindFirst: vi.fn(),
  cashMovementCreate: vi.fn(),
  executeRaw: vi.fn(),
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
        cashShiftId,
        amount: 150,
        status: "PAID",
      },
    });
    mocks.orderFindMany.mockResolvedValue([]);
    mocks.paymentOptionFindMany.mockResolvedValue([]);
    mocks.paymentOptionFindFirst.mockResolvedValue({ id: paymentOptionId, name: "LINE Pay", kind: "OTHER" });
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.cashShiftFindFirst.mockResolvedValue({ id: cashShiftId });
    mocks.cashMovementCreate.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    mocks.executeRaw.mockResolvedValue(1);
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderEventCreate.mockResolvedValue({ id: orderEventId });
    mocks.transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => callback({
      payment: { updateMany: mocks.paymentUpdateMany },
      order: { updateMany: mocks.orderUpdateMany },
      orderEvent: { create: mocks.orderEventCreate },
      cashShift: { findFirst: mocks.cashShiftFindFirst },
      cashMovement: { create: mocks.cashMovementCreate },
      $executeRaw: mocks.executeRaw,
    }));
  });

  it("rejects attempts to include product or quantity changes", async () => {
    const response = await patch({
      operation: "CHANGE_COMPLETED_PAYMENT",
      orderId,
      paymentOptionId,
      reason: "顧客改用 LINE Pay",
      managerAuthorizationCode: "246810",
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
          AND: [{
            OR: [
              { status: "COMPLETED", completedAt: { gte: new Date("2026-08-22T16:00:00Z"), lt: new Date("2026-08-23T16:00:00Z") } },
              { status: "CANCELLED", cancelledAt: { gte: new Date("2026-08-22T16:00:00Z"), lt: new Date("2026-08-23T16:00:00Z") } },
            ],
          }],
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the current-day terminal filter when searching and ignores hidden history parameters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
    try {
      const route = await import("./route");
      const response = await route.GET(
        new Request("https://example.test/api/stalls/demo/completed-orders?query=A023&from=2020-01-01T00%3A00%3A00Z&to=2030-01-01T00%3A00%3A00Z"),
        { params: Promise.resolve({ stallSlug: "demo" }) },
      );

      expect(response.status).toBe(200);
      expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          organizationId,
          stallId,
          AND: [
            {
              OR: [
                { status: "COMPLETED", completedAt: { gte: new Date("2026-08-22T16:00:00Z"), lt: new Date("2026-08-23T16:00:00Z") } },
                { status: "CANCELLED", cancelledAt: { gte: new Date("2026-08-22T16:00:00Z"), lt: new Date("2026-08-23T16:00:00Z") } },
              ],
            },
            {
              OR: [
                { orderNo: { contains: "A023", mode: "insensitive" } },
                { customerName: { contains: "A023", mode: "insensitive" } },
                { customerPhone: { contains: "A023" } },
              ],
            },
          ],
        },
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
      managerAuthorizationCode: "246810",
    });

    expect(response.status).toBe(200);
    expect(mocks.verifyManagerAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      operation: "CHANGE_COMPLETED_PAYMENT",
      authorizationCode: "246810",
    }));
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: paymentId,
        orderId,
        status: "PAID",
        paymentOptionId: "77777777-7777-4777-8777-777777777777",
        method: "CASH",
        cashShiftId,
      },
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
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.cashShiftFindFirst).toHaveBeenCalledWith({
      where: { id: cashShiftId, organizationId, stallId, status: "OPEN" },
      select: { id: true },
    });
    expect(mocks.cashMovementCreate).toHaveBeenCalledWith({
      data: {
        organizationId,
        stallId,
        cashShiftId,
        type: "CASH_OUT",
        amount: 150,
        reason: "付款方式更正：顧客改用 LINE Pay",
        referenceType: "PAYMENT_METHOD_CORRECTION",
        referenceId: orderEventId,
        recordedById: "66666666-6666-4666-8666-666666666666",
      },
    });
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "COMPLETED_PAYMENT_METHOD_CHANGED",
      before: expect.objectContaining({ methodLabel: "現金" }),
      after: expect.objectContaining({ methodLabel: "LINE Pay", cashShiftId: null }),
    }));
  });

  it("rejects a concurrent payment correction after the original payment snapshot changed", async () => {
    mocks.paymentUpdateMany.mockResolvedValueOnce({ count: 0 });

    const response = await patch({
      operation: "CHANGE_COMPLETED_PAYMENT",
      orderId,
      paymentOptionId,
      reason: "顧客改用 LINE Pay",
      managerAuthorizationCode: "246810",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "訂單已被其他人更新，請重新查詢後再試。" });
    expect(mocks.orderEventCreate).not.toHaveBeenCalled();
    expect(mocks.cashMovementCreate).not.toHaveBeenCalled();
  });

  it("跨現金與非現金更正時，現金班次已關閉則拒絕改寫帳務", async () => {
    mocks.cashShiftFindFirst.mockResolvedValueOnce(null);

    const response = await patch({
      operation: "CHANGE_COMPLETED_PAYMENT",
      orderId,
      paymentOptionId,
      reason: "顧客改用 LINE Pay",
      managerAuthorizationCode: "246810",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "跨現金與非現金更正前，必須先開啟現金班次；已關班的帳務請從現金交班處理。",
    });
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
  });

  it("付款資料庫更新失敗時仍回傳 JSON 錯誤契約", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("constraint failed"));

    const response = await patch({
      operation: "CHANGE_COMPLETED_PAYMENT",
      orderId,
      paymentOptionId,
      reason: "顧客改用 LINE Pay",
      managerAuthorizationCode: "246810",
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "付款方式更新失敗，請稍後再試。" });
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
