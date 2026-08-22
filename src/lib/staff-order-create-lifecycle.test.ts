import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const orderFindFirst = vi.fn();
  const orderCreate = vi.fn();
  const orderUpdate = vi.fn();
  const queryRaw = vi.fn();
  const stallOrderingSettingsFindUnique = vi.fn();
  const stallProductFindMany = vi.fn();
  const stallOrderCounterUpsert = vi.fn();
  const transaction = {
    $queryRaw: queryRaw,
    stallOrderingSettings: { findUnique: stallOrderingSettingsFindUnique },
    stallProduct: { findMany: stallProductFindMany },
    diningTable: { findFirst: vi.fn() },
    stallOrderCounter: { upsert: stallOrderCounterUpsert },
    order: { create: orderCreate, update: orderUpdate },
  };
  return {
    orderFindFirst,
    orderCreate,
    orderUpdate,
    queryRaw,
    stallOrderingSettingsFindUnique,
    stallProductFindMany,
    stallOrderCounterUpsert,
    transaction,
    calculateCapacitySnapshot: vi.fn(),
    requireOpenCashShift: vi.fn(),
    resolveStaffCheckout: vi.fn(),
    prisma: {
      order: { findFirst: orderFindFirst },
      stallOrderingSettings: { findUnique: stallOrderingSettingsFindUnique },
      stallProduct: { findMany: stallProductFindMany },
      diningTable: { findFirst: vi.fn() },
      $transaction: vi.fn(async (operation: (client: typeof transaction) => unknown) => operation(transaction)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/capacity", () => ({
  calculateCapacitySnapshot: mocks.calculateCapacitySnapshot,
}));
vi.mock("@/lib/cash-shifts", () => ({
  CashShiftOperationError: class CashShiftOperationError extends Error {
    code = "ACTIVE_SHIFT_REQUIRED";
  },
  requireOpenCashShift: mocks.requireOpenCashShift,
}));
vi.mock("@/lib/staff-checkout", () => ({
  resolveStaffCheckout: mocks.resolveStaffCheckout,
}));
vi.mock("@/lib/security", () => ({
  createOpaqueToken: () => "opaque-token",
  hashToken: () => "a".repeat(64),
}));

import { createStaffOrder } from "./staff-order-create";

const organizationId = "10000000-0000-4000-8000-000000000001";
const stallId = "20000000-0000-4000-8000-000000000001";
const productId = "30000000-0000-4000-8000-000000000001";

describe("staff order persistence lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orderFindFirst.mockResolvedValue(null);
    mocks.stallOrderingSettingsFindUnique.mockResolvedValue({
      unconfirmedOrderTimeoutSeconds: 300,
      dineInEnabled: true,
      staffDeliveryEnabled: true,
      maxItemQuantity: 10,
      maxUniqueProducts: 10,
      maxTotalQuantity: 20,
      maxNoteLength: 200,
    });
    mocks.stallProductFindMany.mockResolvedValue([{
      productId,
      priceOverride: null,
      product: {
        organizationId,
        name: "冬瓜茶",
        defaultPrice: 35,
        kind: "SINGLE",
        isOrderDiscountEligible: true,
        bundleChoiceGroups: [],
        noteGroupAssignments: [],
      },
    }]);
    mocks.calculateCapacitySnapshot.mockResolvedValue({ quoteMaxMinutes: 10 });
    mocks.stallOrderCounterUpsert.mockResolvedValue({ nextValue: 2 });
    mocks.queryRaw
      .mockResolvedValueOnce([{ business_date: new Date("2026-08-22T00:00:00.000Z") }])
      .mockResolvedValueOnce([]);
    mocks.orderCreate.mockResolvedValue({ id: "order-1", status: "WAITING_CONFIRMATION" });
    mocks.orderUpdate.mockResolvedValue({ id: "order-1", status: "CONFIRMED" });
  });

  it("persists items before confirming a staff order so scoped print rules can match", async () => {
    await createStaffOrder({
      organizationId,
      stallId,
      actorProfileId: "40000000-0000-4000-8000-000000000001",
      actorRoles: ["STAFF"],
      request: {
        idempotencyKey: "50000000-0000-4000-8000-000000000001",
        customerName: "現場顧客",
        customerPhone: "",
        customerNote: "",
        fulfillmentType: "TAKEOUT",
        requestedFulfillmentAt: null,
        paymentTiming: "PAY_LATER",
        items: [{
          productId,
          quantity: 1,
          note: "",
          noteOptionIds: [],
          bundleChoiceIds: [],
        }],
      },
    });

    expect(mocks.orderCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "WAITING_CONFIRMATION",
        paymentStatus: "UNPAID",
        confirmedAt: null,
        items: expect.objectContaining({ create: expect.any(Array) }),
      }),
    }));
    expect(mocks.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "order-1" },
      data: expect.objectContaining({ status: "CONFIRMED" }),
    }));
    expect(mocks.orderCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.orderUpdate.mock.invocationCallOrder[0]!,
    );
  });
});
