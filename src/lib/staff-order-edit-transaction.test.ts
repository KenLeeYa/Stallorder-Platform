import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const noteOptionId = "66666666-6666-4666-8666-666666666666";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdateMany: vi.fn(),
  itemDeleteMany: vi.fn(),
  itemCreate: vi.fn(),
  eventCreate: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/orders", () => ({
  staffOrderSelect: {},
  serializeStaffOrder: (order: unknown) => order,
}));
vi.mock("@/lib/staff-order-create", () => {
  class StaffOrderCreateError extends Error {}
  return { StaffOrderCreateError, prepareStaffOrderItems: mocks.prepare };
});

function databaseOrder() {
  return {
    id: orderId,
    orderNo: "260813-001",
    source: "STAFF_POS",
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    note: null,
    discountAmount: 0,
    discountOptionId: null,
    subtotal: 100,
    total: 100,
    payment: null,
    printJobs: [{ status: "PENDING" }],
    items: [{
      id: itemId,
      productId,
      name: "舊價格商品",
      unitPrice: 100,
      quantity: 1,
      note: null,
      status: "PENDING",
      productionTask: { status: "PENDING" },
      noteOptions: [{
        noteOptionId,
        groupName: "辣度",
        optionName: "小辣",
        priceDelta: 0,
      }],
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw
    .mockResolvedValueOnce([{ id: orderId }])
    .mockResolvedValue([]);
  mocks.orderFindUnique
    .mockResolvedValueOnce(databaseOrder())
    .mockResolvedValueOnce({ id: orderId, orderNo: "260813-001", total: 240 });
  mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
  mocks.itemDeleteMany.mockResolvedValue({ count: 1 });
  mocks.itemCreate.mockResolvedValue({ id: "77777777-7777-4777-8777-777777777777" });
  mocks.eventCreate.mockResolvedValue({});
  mocks.prepare.mockResolvedValue({
    settings: { maxItemQuantity: 100, maxUniqueProducts: 100, maxTotalQuantity: 100, maxNoteLength: 1000 },
    subtotal: 240,
    discountEligibleSubtotal: 240,
    items: [{
      productId,
      name: "目前目錄名稱",
      baseUnitPrice: 120,
      unitPrice: 120,
      quantity: 2,
      isOrderDiscountEligible: true,
      note: null,
      noteOptions: [{
        noteGroupId: "88888888-8888-4888-8888-888888888888",
        noteOptionId,
        groupName: "辣度",
        optionName: "小辣",
        priceDelta: 0,
        sortOrder: 0,
      }],
    }],
  });
  mocks.transaction.mockImplementation(async (operation) => operation({
    $queryRaw: mocks.queryRaw,
    order: { findUnique: mocks.orderFindUnique, updateMany: mocks.orderUpdateMany },
    orderItem: { deleteMany: mocks.itemDeleteMany, create: mocks.itemCreate },
    orderEvent: { create: mocks.eventCreate },
  }));
});

describe("editStaffOrderItems transaction", () => {
  it("locks order, items, KDS tasks, and print jobs before checking eligibility", async () => {
    const { editStaffOrderItems } = await import("@/lib/staff-order-edit");

    await editStaffOrderItems({
      organizationId,
      stallId,
      orderId,
      actorProfileId: organizationId,
      request: { items: [{ kind: "EXISTING", itemId, quantity: 2 }] },
    });

    const statements = mocks.queryRaw.mock.calls.map(([statement]) => (
      (statement as { strings?: string[] }).strings?.join("?").replace(/\s+/g, " ").trim() ?? ""
    ));
    expect(statements.slice(0, 4)).toEqual([
      expect.stringContaining("from public.orders"),
      expect.stringContaining("from public.order_items"),
      expect.stringContaining("from public.order_production_tasks"),
      expect.stringContaining("from public.print_jobs"),
    ]);
    expect(mocks.orderFindUnique.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.queryRaw.mock.invocationCallOrder[3],
    );
  });

  it("reprices from the trusted catalog, removes old KDS-linked lines, and records snapshots atomically", async () => {
    const { editStaffOrderItems } = await import("@/lib/staff-order-edit");

    const result = await editStaffOrderItems({
      organizationId,
      stallId,
      orderId,
      actorProfileId: organizationId,
      request: { items: [{ kind: "EXISTING", itemId, quantity: 2 }] },
    });

    expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), organizationId, stallId, {
      customerNote: "",
      items: [{
        productId,
        quantity: 2,
        note: "",
        noteOptionIds: [noteOptionId],
        bundleChoiceIds: [],
      }],
    });
    expect(mocks.itemDeleteMany).toHaveBeenCalledWith({
      where: {
        orderId,
        stallId,
        status: "PENDING",
        productionTask: { is: { status: "PENDING" } },
      },
    });
    expect(mocks.itemDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.itemCreate.mock.invocationCallOrder[0]);
    expect(mocks.itemCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "目前目錄名稱", unitPrice: 120, quantity: 2 }),
    }));
    expect(mocks.orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { subtotal: 240, total: 240 },
    }));
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "STAFF_ORDER_ITEMS_EDITED",
        metadataJson: expect.objectContaining({
          before: expect.objectContaining({ total: 100 }),
          after: expect.objectContaining({ total: 240 }),
        }),
      }),
    }));
    expect(result.order).toMatchObject({ total: 240 });
  });

  it("aborts before replacement when a KDS transition wins the conditional delete race", async () => {
    const { editStaffOrderItems, StaffOrderEditError } = await import("@/lib/staff-order-edit");
    mocks.itemDeleteMany.mockResolvedValue({ count: 0 });

    await expect(editStaffOrderItems({
      organizationId,
      stallId,
      orderId,
      actorProfileId: organizationId,
      request: { items: [{ kind: "EXISTING", itemId, quantity: 2 }] },
    })).rejects.toEqual(new StaffOrderEditError("ORDER_ALREADY_STARTED"));

    expect(mocks.itemCreate).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });
});
