import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  persistExternalOrderTransitionForOrder: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: {},
}));
vi.mock("@/server/delivery-platforms/external-order-status-service", () => ({
  persistExternalOrderTransitionForOrder: mocks.persistExternalOrderTransitionForOrder,
}));

import { applyKitchenTaskUpdate, completeKitchenOrder } from "./kitchen";

const futureOrder = {
  id: "order-1",
  status: "CONFIRMED",
  organizationId: "organization-1",
  stallId: "stall-1",
  scheduledPickupAt: null,
  requestedFulfillmentAt: new Date("2099-08-14T04:00:00.000Z"),
  committedFulfillmentAt: new Date("2099-08-14T04:00:00.000Z"),
  fulfillmentTimeState: "CONFIRMED",
  stall: {
    timezone: "Asia/Taipei",
    orderingSettings: { businessDayCutoffHour: 3 },
  },
};

describe("KDS future fulfillment mutation guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects starting a task before the stall-local fulfillment business date", async () => {
    const transaction = {
      $queryRaw: vi.fn(),
      orderProductionTask: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ orderId: futureOrder.id, orderItemId: "item-1" })
          .mockResolvedValueOnce({
            id: "task-1",
            orderId: futureOrder.id,
            orderItemId: "item-1",
            status: "PENDING",
            order: futureOrder,
            orderItem: { id: "item-1", status: "PENDING" },
          }),
      },
      orderItem: { update: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (callback) => callback(transaction));

    await expect(applyKitchenTaskUpdate({
      organizationId: futureOrder.organizationId,
      stallId: futureOrder.stallId,
      actorProfileId: "profile-1",
      taskId: "task-1",
      status: "PREPARING",
    })).rejects.toMatchObject({ code: "PRODUCTION_NOT_DUE" });
    expect(transaction.orderItem.update).not.toHaveBeenCalled();
  });

  it("locks in order-item-task order and lets an already-started future order continue", async () => {
    const task = {
      id: "task-1",
      orderId: futureOrder.id,
      orderItemId: "item-1",
      status: "PENDING",
      order: { ...futureOrder, status: "PREPARING" },
      orderItem: { id: "item-1", status: "PENDING" },
    };
    const transaction = {
      $queryRaw: vi.fn(),
      orderProductionTask: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ orderId: task.orderId, orderItemId: task.orderItemId })
          .mockResolvedValueOnce(task),
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { status: "PREPARING", station: { code: "DEFAULT" } },
        ]),
      },
      orderItem: { update: vi.fn() },
      order: { update: vi.fn() },
      orderEvent: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (callback) => callback(transaction));

    await expect(applyKitchenTaskUpdate({
      organizationId: futureOrder.organizationId,
      stallId: futureOrder.stallId,
      actorProfileId: "profile-1",
      taskId: task.id,
      status: "PREPARING",
    })).resolves.toMatchObject({ orderId: task.orderId });

    const lockedTables = transaction.$queryRaw.mock.calls.map(([template]) => (
      (template as TemplateStringsArray).join(" ").match(/public\.(orders|order_items|order_production_tasks)/)?.[1]
    ));
    expect(lockedTables).toEqual(["orders", "order_items", "order_production_tasks"]);
  });

  it("allows an already-started future order to finish instead of stranding it", async () => {
    const transaction = {
      $queryRaw: vi.fn(),
      order: {
        findFirst: vi.fn().mockResolvedValue({
          ...futureOrder,
          status: "PREPARING",
          items: [{ id: "item-1", status: "PREPARING" }],
          productionTasks: [{ id: "task-1" }],
        }),
        update: vi.fn(),
      },
      orderItem: { updateMany: vi.fn() },
      orderProductionTask: { updateMany: vi.fn() },
      orderEvent: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (callback) => callback(transaction));

    await expect(completeKitchenOrder({
      organizationId: futureOrder.organizationId,
      stallId: futureOrder.stallId,
      actorProfileId: "profile-1",
      orderId: futureOrder.id,
    })).resolves.toMatchObject({ orderId: futureOrder.id });
    expect(transaction.order.update).toHaveBeenCalledWith({
      where: { id: futureOrder.id },
      data: { status: "READY" },
    });
  });

  it("rejects completing a whole order before its fulfillment business date", async () => {
    const transaction = {
      $queryRaw: vi.fn(),
      order: {
        findFirst: vi.fn().mockResolvedValue({
          ...futureOrder,
          items: [{ id: "item-1", status: "PENDING" }],
          productionTasks: [{ id: "task-1" }],
        }),
        update: vi.fn(),
      },
      orderItem: { updateMany: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (callback) => callback(transaction));

    await expect(completeKitchenOrder({
      organizationId: futureOrder.organizationId,
      stallId: futureOrder.stallId,
      actorProfileId: "profile-1",
      orderId: futureOrder.id,
    })).rejects.toMatchObject({ code: "PRODUCTION_NOT_DUE" });
    expect(transaction.orderItem.updateMany).not.toHaveBeenCalled();
    expect(transaction.order.update).not.toHaveBeenCalled();
  });
});
