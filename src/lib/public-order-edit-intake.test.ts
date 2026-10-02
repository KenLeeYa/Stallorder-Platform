import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateTrackedPublicOrderInput } from "./public-order-edit-contract";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    order: { findUnique: vi.fn(), updateMany: vi.fn() },
    stallProduct: { count: vi.fn() },
    printJob: { deleteMany: vi.fn() },
    orderItem: { deleteMany: vi.fn(), create: vi.fn() },
    orderEvent: { create: vi.fn() },
  };
  return {
    transaction,
    prepareStaffOrderItems: vi.fn(),
    prisma: { $transaction: vi.fn(async (operation: (client: typeof transaction) => unknown) => operation(transaction)) },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/staff-order-create", () => ({
  prepareStaffOrderItems: mocks.prepareStaffOrderItems,
  StaffOrderCreateError: class extends Error { constructor(public code: string) { super(code); } },
}));

import { editTrackedPublicOrder, publicOrderEditAddsFulfillment } from "./public-order-edit";

const productId = "30000000-0000-4000-8000-000000000001";
const orderId = "40000000-0000-4000-8000-000000000001";
function request(quantity = 1): UpdateTrackedPublicOrderInput {
  return {
    deviceId: "50000000-0000-4000-8000-000000000001", idempotencyKey: "60000000-0000-4000-8000-000000000001",
    turnstileToken: "test", customerName: "測試", customerPhone: "0912345678", deliveryAddress: "測試地址", customerNote: "",
    items: [{ productId, quantity, note: "", noteOptionIds: [], bundleChoiceIds: [] }],
  };
}
function order(orderingMode = "DEFAULT") {
  return {
    id: orderId, organizationId: "10000000-0000-4000-8000-000000000001", stallId: "20000000-0000-4000-8000-000000000001",
    source: "QR_MENU", status: "WAITING_CONFIRMATION", paymentStatus: "UNPAID", payment: null,
    fulfillmentType: "TAKEOUT", discountAmount: 0, discountOptionId: null, subtotal: 100, total: 100,
    scheduledPickupAt: null, requestedFulfillmentAt: null,
    orderSession: { orderingMode, createdAt: new Date("2026-10-01T04:00:00Z"), qrCode: { token: "test-qr", diningTableId: null, fulfillmentTypeContext: null } },
    items: [{ id: "line", productId, quantity: 1, status: "PENDING", productionTask: null }], printJobs: [],
  };
}
function intakeQueries() {
  return mocks.transaction.$queryRaw.mock.calls.filter(([query]) => query.sql.includes("public_order_calendar_code"));
}

describe("public edit added fulfillment authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRaw.mockImplementation(async (query) => query.sql.includes("public_order_calendar_code")
      ? [{ code: "STALL_CLOSED" }] : [{ id: orderId }]);
    mocks.transaction.order.findUnique.mockResolvedValue(order());
    mocks.transaction.stallProduct.count.mockResolvedValue(0);
    mocks.transaction.printJob.deleteMany.mockResolvedValue({ count: 0 });
    mocks.transaction.orderItem.deleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.order.updateMany.mockResolvedValue({ count: 1 });
    mocks.prepareStaffOrderItems.mockResolvedValue({
      settings: { unconfirmedOrderTimeoutSeconds: 300 }, subtotal: 100,
      items: [{ productId, name: "測試商品", baseUnitPrice: 100, unitPrice: 100, quantity: 1, note: "", noteOptions: [] }],
    });
  });

  it("rejects added quantities after closure before changing items, stock or events", async () => {
    await expect(editTrackedPublicOrder({ orderId, request: request(2) })).rejects.toMatchObject({ code: "STALL_CLOSED" });
    expect(intakeQueries()).toHaveLength(1);
    expect(mocks.transaction.orderItem.deleteMany).not.toHaveBeenCalled();
    expect(mocks.transaction.order.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.orderEvent.create).not.toHaveBeenCalled();
  });

  it.each(["ORDERING_PAUSED", "DELIVERY_UNAVAILABLE", "QR_NOT_ACTIVE", "SCHEDULE_CLOSED", "TABLE_UNAVAILABLE"])("returns authoritative %s for additions", async (code) => {
    mocks.transaction.$queryRaw.mockImplementation(async (query) => query.sql.includes("public_order_calendar_code") ? [{ code }] : [{ id: orderId }]);
    await expect(editTrackedPublicOrder({ orderId, request: request(2) })).rejects.toMatchObject({ code });
    expect(mocks.transaction.orderItem.deleteMany).not.toHaveBeenCalled();
  });

  it("preserves an existing same-quantity note edit after intake closes", async () => {
    const input = request(); input.items[0].note = "不要辣";
    await expect(editTrackedPublicOrder({ orderId, request: input })).resolves.toMatchObject({ orderStatus: "WAITING_CONFIRMATION" });
    expect(intakeQueries()).toHaveLength(0);
  });

  it("requires calendar admission for same-SKU same-quantity bundle replacement", async () => {
    mocks.prepareStaffOrderItems.mockResolvedValue({ settings: {}, items: [], subtotal: 100, addsBundleFulfillment: true });
    await expect(editTrackedPublicOrder({ orderId, request: request() })).rejects.toMatchObject({ code: "STALL_CLOSED" });
    expect(mocks.transaction.orderItem.deleteMany).not.toHaveBeenCalled();
  });

  it("locks the scoped dining table before reading its active state", async () => {
    const stored = order(); stored.orderSession.qrCode.diningTableId = "70000000-0000-4000-8000-000000000001" as never;
    mocks.transaction.order.findUnique.mockResolvedValue(stored);
    await expect(editTrackedPublicOrder({ orderId, request: request(2) })).rejects.toMatchObject({ code: "STALL_CLOSED" });
    const queries = mocks.transaction.$queryRaw.mock.calls.map(([query]) => query.sql);
    const tableLockIndex = queries.findIndex((query) => query.includes("select id from public.dining_tables"));
    expect(queries[tableLockIndex]).toContain("organization_id");
    expect(queries[tableLockIndex]).toContain("for share");
    expect(tableLockIndex).toBeLessThan(queries.findIndex((query) => query.includes("public_order_calendar_code")));
    expect(intakeQueries()[0][0].sql).toContain("qr.dining_table_id is not distinct from");
    expect(intakeQueries()[0][0].values).toContain(stored.orderSession.qrCode.diningTableId);
  });

  it("fails closed if QR table binding no longer matches the locked snapshot", async () => {
    mocks.transaction.$queryRaw.mockImplementation(async (query) => query.sql.includes("public_order_calendar_code") ? [] : [{ id: orderId }]);
    await expect(editTrackedPublicOrder({ orderId, request: request(2) })).rejects.toMatchObject({ code: "QR_NOT_ACTIVE" });
    expect(mocks.transaction.orderItem.deleteMany).not.toHaveBeenCalled();
  });

  it("preserves reductions without calendar admission", async () => {
    const stored = order(); stored.items[0].quantity = 2;
    mocks.transaction.order.findUnique.mockResolvedValue(stored);
    await expect(editTrackedPublicOrder({ orderId, request: request() })).resolves.toMatchObject({ orderStatus: "WAITING_CONFIRMATION" });
    expect(intakeQueries()).toHaveLength(0);
  });

  it("checks preorder availability at its existing future fulfillment time", async () => {
    const fulfillmentAt = new Date("2026-10-09T04:00:00Z");
    mocks.transaction.order.findUnique.mockResolvedValue({ ...order("PREORDER"), requestedFulfillmentAt: fulfillmentAt });
    await editTrackedPublicOrder({ orderId, request: request() });
    expect(mocks.prepareStaffOrderItems.mock.calls[0][4]).toEqual(fulfillmentAt);
    expect(mocks.prepareStaffOrderItems.mock.calls[0][5]).toBe(true);
  });

  it.each([
    ["disabled preorder module", "PREORDER_DISABLED"],
    ["revoked future slot", "PREORDER_TIME_INVALID"],
    ["expired fulfillment time", "PREORDER_TIME_INVALID"],
  ])("rejects added preorder fulfillment for %s", async (_condition, code) => {
    const fulfillmentAt = new Date("2026-10-09T04:00:00Z");
    const stored = { ...order("PREORDER"), requestedFulfillmentAt: fulfillmentAt };
    mocks.transaction.order.findUnique.mockResolvedValue(stored);
    mocks.transaction.$queryRaw.mockImplementation(async (query) => query.sql.includes("public_order_calendar_code")
      ? [{ code: query.sql.includes("validate_takeout_preorder_slot") ? code : null }]
      : [{ id: orderId }]);
    await expect(editTrackedPublicOrder({ orderId, request: request(2) })).rejects.toMatchObject({ code });
    const query = intakeQueries()[0][0];
    expect(query.values).toContainEqual(fulfillmentAt);
    expect(query.values).toContainEqual(stored.orderSession.createdAt);
    expect(mocks.transaction.orderItem.deleteMany).not.toHaveBeenCalled();
    expect(mocks.transaction.order.updateMany).not.toHaveBeenCalled();
  });

  it("preserves the existing preorder time and permits additions to a valid future slot", async () => {
    const fulfillmentAt = new Date("2026-10-09T04:00:00Z");
    mocks.transaction.order.findUnique.mockResolvedValue({ ...order("PREORDER"), requestedFulfillmentAt: fulfillmentAt });
    mocks.transaction.$queryRaw.mockImplementation(async (query) => query.sql.includes("public_order_calendar_code") ? [{ code: null }] : [{ id: orderId }]);
    await editTrackedPublicOrder({ orderId, request: request(2) });
    expect(intakeQueries()[0][0].sql).toContain("validate_takeout_preorder_slot");
    expect(mocks.transaction.order.updateMany.mock.calls[0][0].data).not.toHaveProperty("requestedFulfillmentAt");
    expect(mocks.transaction.order.updateMany.mock.calls[0][0].data).not.toHaveProperty("scheduledPickupAt");
  });

  it("detects newly substituted products and aggregates split configurations", () => {
    expect(publicOrderEditAddsFulfillment([{ productId, quantity: 2 }], [{ productId, quantity: 1 }, { productId, quantity: 1 }])).toBe(false);
    expect(publicOrderEditAddsFulfillment([{ productId, quantity: 1 }], [{ productId, quantity: 1 }, { productId, quantity: 1 }])).toBe(true);
    expect(publicOrderEditAddsFulfillment([{ productId, quantity: 2 }], [{ productId: "another", quantity: 1 }])).toBe(true);
  });
});
