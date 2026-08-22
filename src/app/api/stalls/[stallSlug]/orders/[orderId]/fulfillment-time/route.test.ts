import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stallId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  transaction: vi.fn(),
  orderFindFirst: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderFindUnique: vi.fn(),
  orderEventCreate: vi.fn(),
  queryRaw: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

function legacyOrder() {
  return {
    id: orderId,
    orderNo: "A003",
    source: "QR_MENU",
    isTest: false,
    customerName: "Legacy customer",
    customerPhone: null,
    deliveryAddress: null,
    tableLabel: null,
    diningTableId: null,
    fulfillmentType: "TAKEOUT",
    note: null,
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    subtotal: 100,
    discountAmount: 0,
    discountLabel: null,
    total: 100,
    pickupCodeLength: 3,
    pickupVerifiedAt: null,
    pickupVerificationMethod: null,
    confirmationExpiresAt: new Date("2026-08-06T04:05:00.000Z"),
    quotedWaitMinutes: 15,
    quotedReadyAt: new Date("2026-08-06T04:15:00.000Z"),
    scheduledPickupAt: new Date("2026-08-07T04:30:00.000Z"),
    requestedFulfillmentAt: null,
    committedFulfillmentAt: null,
    pendingFulfillmentAt: null,
    fulfillmentTimeState: "NOT_REQUESTED",
    fulfillmentTimeVersion: 0,
    fulfillmentTimeResponseExpiresAt: null,
    fulfillmentTimeChangeReason: null,
    createdAt: new Date("2026-08-06T04:00:00.000Z"),
    printJobs: [],
    items: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T03:00:00.000Z"));
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "44444444-4444-4444-8444-444444444444" } },
    stall: { id: stallId, organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.readJson.mockResolvedValue({
    data: {
      operation: "PROPOSE",
      version: 0,
      proposedFulfillmentAt: "2026-08-07T04:45:00.000Z",
      reason: "調整既有預約時間",
    },
  });
  mocks.orderFindFirst.mockResolvedValue(legacyOrder());
  mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
  mocks.orderEventCreate.mockResolvedValue({});
  mocks.queryRaw.mockResolvedValue([{ code: null }]);
  mocks.orderFindUnique.mockImplementation(async () => ({
    ...legacyOrder(),
    pendingFulfillmentAt: new Date("2026-08-07T04:45:00.000Z"),
    fulfillmentTimeState: "CUSTOMER_ACTION_REQUIRED",
    fulfillmentTimeVersion: 1,
    fulfillmentTimeResponseExpiresAt: new Date("2026-08-06T03:30:00.000Z"),
    fulfillmentTimeChangeReason: "調整既有預約時間",
  }));
  mocks.transaction.mockImplementation(async (operation) => operation({
    $queryRaw: mocks.queryRaw,
    order: {
      findFirst: mocks.orderFindFirst,
      updateMany: mocks.orderUpdateMany,
      findUnique: mocks.orderFindUnique,
    },
    orderEvent: { create: mocks.orderEventCreate },
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

async function proposeVersionZero() {
  const route = await import("./route");
  return route.PATCH(
    new Request("https://example.test/api/stalls/demo/orders/order/fulfillment-time", {
      method: "PATCH",
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ stallSlug: "demo", orderId }) },
  );
}

describe("staff fulfillment-time legacy version zero boundary", () => {
  it("allows only the scheduled legacy QR takeout fixture to create version one", async () => {
    const response = await proposeVersionZero();

    expect(response.status).toBe(200);
    expect(mocks.orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ fulfillmentTimeVersion: 0 }),
      data: expect.objectContaining({
        fulfillmentTimeState: "CUSTOMER_ACTION_REQUIRED",
        fulfillmentTimeVersion: 1,
      }),
    }));
  });

  it.each([
    ["staff POS", { source: "STAFF_POS", scheduledPickupAt: null }],
    ["new QR without a selected time", { source: "QR_MENU", scheduledPickupAt: null }],
    ["stale version", { fulfillmentTimeVersion: 1 }],
  ])("rejects %s version zero proposals", async (_label, override) => {
    mocks.orderFindFirst.mockResolvedValue({ ...legacyOrder(), ...override });

    const response = await proposeVersionZero();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "CONFLICT" });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
  });
});
