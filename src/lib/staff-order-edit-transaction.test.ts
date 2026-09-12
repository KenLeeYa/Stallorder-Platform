import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStaffOrderItemsInput } from "./staff-order-edit-contract";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const changeId = "66666666-6666-4666-8666-666666666666";
const expectedUpdatedAt = "2026-09-11T08:00:00.000Z";
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), query: vi.fn(), find: vi.fn(), update: vi.fn(), itemUpdate: vi.fn(),
  itemDelete: vi.fn(), itemCreate: vi.fn(), itemFind: vi.fn(), eventFind: vi.fn(), eventCreate: vi.fn(),
  prepare: vi.fn(), freeze: vi.fn(), print: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/orders", () => ({ staffOrderSelect: {}, serializeStaffOrder: (order: unknown) => order }));
vi.mock("@/server/printing/order-amendment-print", () => ({ freezeOrderPrintDocuments: mocks.freeze, queueOrderAmendmentPrints: mocks.print }));
vi.mock("@/lib/staff-order-create", () => {
  class StaffOrderCreateError extends Error { constructor(public code: string) { super(code); } }
  return { StaffOrderCreateError, prepareStaffOrderItems: mocks.prepare };
});

function databaseOrder() {
  return {
    id: orderId, orderNo: "260911-001", source: "STAFF_POS", origin: "STAFF_POS", fulfillmentType: "TAKEOUT",
    status: "CONFIRMED", paymentStatus: "UNPAID", payment: null, note: null,
    discountAmount: 0, discountOptionId: null, subtotal: 200, total: 200, updatedAt: new Date(expectedUpdatedAt),
    printJobs: [{ status: "SUCCEEDED" }],
    items: [{ id: itemId, productId, sourceLineIndex: 100, name: "原價商品", unitPrice: 100, baseUnitPrice: 100,
      quantity: 2, note: "不要香菜", status: "PENDING", promotionSource: "NONE", isOrderDiscountEligible: true,
      product: { categoryId: productId, groupId: null }, productionTask: { status: "PENDING" },
      noteOptions: [{ noteGroupId: null, noteOptionId: null, groupName: "原套餐", optionName: "已下架配菜", priceDelta: 0, sortOrder: 0 }],
    }],
  };
}
let order: ReturnType<typeof databaseOrder>;
const request = (override: Partial<UpdateStaffOrderItemsInput> = {}): UpdateStaffOrderItemsInput => ({
  changeId, expectedUpdatedAt, items: [{ kind: "EXISTING", itemId, quantity: 1 }], ...override,
});
async function run(input = request()) {
  const { editStaffOrderItems } = await import("./staff-order-edit");
  return editStaffOrderItems({ organizationId, stallId, orderId, actorProfileId: organizationId, request: input });
}
beforeEach(() => {
  vi.resetAllMocks(); order = databaseOrder();
  mocks.query.mockImplementation(async (statement: { strings: string[] }) => statement.strings.join("").includes("from public.orders") ? [{ id: orderId }] : []);
  mocks.find.mockImplementation(async () => structuredClone(order));
  mocks.update.mockImplementation(async ({ data }) => { Object.assign(order, data, { updatedAt: new Date("2026-09-11T08:00:01.000Z") }); return { count: 1 }; });
  mocks.itemUpdate.mockImplementation(async ({ where, data }) => { const item = order.items.find((row) => row.id === where.id); if (item) Object.assign(item, data); return { count: item ? 1 : 0 }; });
  mocks.itemDelete.mockImplementation(async ({ where }) => { order.items = order.items.filter((item) => !where.id.in.includes(item.id)); return { count: where.id.in.length }; });
  mocks.itemFind.mockImplementation(async () => structuredClone(order.items));
  mocks.itemCreate.mockResolvedValue({ id: productId });
  mocks.eventFind.mockResolvedValue(null);
  mocks.eventCreate.mockResolvedValue({});
  mocks.freeze.mockResolvedValue([{ id: "original-print" }]);
  mocks.prepare.mockResolvedValue({ items: [], subtotal: 0, settings: { maxItemQuantity: 100, maxTotalQuantity: 100, maxUniqueProducts: 100, maxNoteLength: 1000 } });
  mocks.transaction.mockImplementation(async (operation) => operation({
    $queryRaw: mocks.query,
    order: { findUnique: mocks.find, findUniqueOrThrow: mocks.find, updateMany: mocks.update },
    orderItem: { updateMany: mocks.itemUpdate, deleteMany: mocks.itemDelete, create: mocks.itemCreate, findMany: mocks.itemFind },
    orderEvent: { findUnique: mocks.eventFind, create: mocks.eventCreate, count: vi.fn().mockResolvedValue(0) },
    stallProduct: { count: vi.fn().mockResolvedValue(1) },
  }));
});

describe("merchant order amendments", () => {
  it("locks order, lines, production tasks and print jobs before reading editable state", async () => {
    await run();
    const statements = mocks.query.mock.calls.slice(0,4).map(([query]) => query.strings.join(" "));
    ["orders", "order_items", "order_production_tasks", "print_jobs"].forEach((table,index) => expect(statements[index]).toContain("public."+table));
    expect(mocks.find.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.query.mock.invocationCallOrder[3]);
  });
  it("keeps existing IDs, prices and legacy option snapshots while reducing quantity", async () => {
    const result = await run();
    expect(result.order).toMatchObject({ id: orderId, total: 100 });
    expect(order.items[0]).toMatchObject({ id: itemId, name: "原價商品", unitPrice: 100, quantity: 1, note: "不要香菜" });
    expect(order.items[0].noteOptions[0]).toMatchObject({ noteOptionId: null, optionName: "已下架配菜" });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), organizationId, stallId, { items: [], customerNote: "" });
    expect(mocks.itemDelete).not.toHaveBeenCalled(); expect(mocks.itemCreate).not.toHaveBeenCalled();
    expect(mocks.freeze.mock.invocationCallOrder[0]).toBeLessThan(mocks.itemUpdate.mock.invocationCallOrder[0]);
    expect(mocks.print).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      amendmentId: changeId, number: 1, originalJobs: [{ id: "original-print" }],
      before: [expect.objectContaining({ quantity: 2 })], after: [expect.objectContaining({ quantity: 1 })],
    }));
  });
  it("rejects a stale screen before touching items or print documents", async () => {
    await expect(run(request({ expectedUpdatedAt: "2026-09-11T07:59:00Z" }))).rejects.toThrow("ORDER_CONFLICT");
    expect(mocks.itemUpdate).not.toHaveBeenCalled(); expect(mocks.freeze).not.toHaveBeenCalled();
  });
  it("reuses a free 1-based line index when a retained item already uses index 100", async () => {
    mocks.prepare.mockResolvedValueOnce({ items: [{ productId, name: "加餐", unitPrice: 100, baseUnitPrice: 100, quantity: 1, note: "", noteOptions: [], isOrderDiscountEligible: true }], settings: { maxItemQuantity: 100, maxTotalQuantity: 100, maxUniqueProducts: 100, maxNoteLength: 1000 } });
    await run(request({ items: [{ kind: "EXISTING", itemId, quantity: 2 }, { kind: "NEW", productId, quantity: 1, note: "", noteOptionIds: [], bundleChoiceIds: [] }] }));
    expect(mocks.itemCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceLineIndex: 1 }) }));
  });
  it("replays a lost successful response without applying or printing the edit again", async () => {
    const first = request(); await run(first);
    const event = mocks.eventCreate.mock.calls[0][0].data;
    mocks.eventFind.mockResolvedValue(event);
    await run(first);
    expect(mocks.itemUpdate).toHaveBeenCalledTimes(1); expect(mocks.print).toHaveBeenCalledTimes(1); expect(mocks.eventCreate).toHaveBeenCalledTimes(1);
    await expect(run(request({ items: [{ kind: "EXISTING", itemId, quantity: 3 }] }))).rejects.toThrow("ORDER_CONFLICT");
  });
  it("does not issue change tickets for a no-op", async () => {
    await run(request({ items: [{ kind: "EXISTING", itemId, quantity: 2 }] }));
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.freeze).not.toHaveBeenCalled(); expect(mocks.eventCreate).not.toHaveBeenCalled();
  });
  it("does not accept a different order's line or a missing tenant order", async () => {
    await expect(run(request({ items: [{ kind: "EXISTING", itemId: productId, quantity: 1 }] }))).rejects.toThrow("ITEM_CONFLICT");
    mocks.query.mockResolvedValue([]);
    await expect(run()).rejects.toThrow("NOT_FOUND");
    expect(mocks.itemUpdate).not.toHaveBeenCalled();
  });
  it("requires and records the customer notice for public takeout", async () => {
    order.source = "QR_MENU";
    await expect(run()).rejects.toThrow("CUSTOMER_NOTICE_REQUIRED");
    await run(request({ publicAmendment: { reason: "SOLD_OUT_REMOVE", customerMessage: "已依您的要求減少一份。" } }));
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      eventType: "PUBLIC_ORDER_ITEMS_ADJUSTED",
      metadataJson: expect.objectContaining({ reason: "SOLD_OUT_REMOVE", customerMessage: "已依您的要求減少一份。" }),
    }) }));
  });
  it.each(["PREPARING", "READY"])("keeps %s production protected", async (status) => {
    order.items[0].productionTask.status = status;
    await expect(run()).rejects.toThrow("ORDER_ALREADY_STARTED"); expect(mocks.freeze).not.toHaveBeenCalled();
  });
  it("aborts if the conditional item write loses its production precondition", async () => {
    mocks.itemUpdate.mockResolvedValue({ count: 0 });
    await expect(run()).rejects.toThrow("ORDER_ALREADY_STARTED"); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.print).not.toHaveBeenCalled();
  });
});
