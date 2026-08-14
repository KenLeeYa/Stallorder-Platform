import { describe, expect, it } from "vitest";
import {
  aggregateKitchenItems,
  canTransitionKitchenTask,
  getKitchenFieldErrors,
  kitchenSettingsSchema,
  kitchenStationCommandSchema,
  kitchenWaitDisplay,
  kitchenWaitLevel,
  partitionKitchenTasksByFulfillmentDate,
  preserveKitchenOrderProgress,
  type KitchenBoardTask,
} from "@/lib/kitchen-contract";

function task(overrides: Partial<KitchenBoardTask> = {}): KitchenBoardTask {
  return {
    id: "task-1",
    orderId: "order-1",
    orderItemId: "item-1",
    orderNo: "A025",
    pickupCode: "738",
    source: "QR_MENU",
    externalProvider: null,
    externalOrderNumber: null,
    scheduledPickupAt: null,
    requestedFulfillmentAt: null,
    committedFulfillmentAt: null,
    fulfillmentTimeState: "CONFIRMED",
    riderPickupAt: null,
    fulfillmentType: "TAKEOUT",
    tableLabel: null,
    orderNote: null,
    orderStatus: "CONFIRMED",
    orderCreatedAt: "2026-07-20T09:00:00.000Z",
    confirmedAt: "2026-07-20T09:01:00.000Z",
    itemName: "雞排",
    quantity: 2,
    itemNote: null,
    modifiers: ["加蛋", "小辣"],
    station: { id: "station-1", name: "炸台", code: "FRY" },
    status: "PENDING",
    startedAt: null,
    completedAt: null,
    assignedTo: null,
    ...overrides,
  };
}

describe("KDS operational helpers", () => {
  it("將工作站與時間門檻錯誤對應至繁體中文欄位提示", () => {
    const station = kitchenStationCommandSchema.safeParse({
      operation: "CREATE_STATION",
      name: "炸台",
      code: "中文代碼",
      description: null,
      sortOrder: 1,
      isActive: true,
    });
    expect(station.success).toBe(false);
    if (!station.success) expect(getKitchenFieldErrors(station.error).code).toContain("工作站代碼");

    const settings = kitchenSettingsSchema.safeParse({
      warningMinutes: 10,
      criticalMinutes: 8,
      defaultView: "ORDER",
    });
    expect(settings.success).toBe(false);
    if (!settings.success) {
      expect(getKitchenFieldErrors(settings.error).criticalMinutes).toBe("嚴重逾時必須大於警示時間。");
    }
  });

  it("applies normal, warning and critical elapsed-time thresholds", () => {
    expect(kitchenWaitLevel(4.9, 5, 10)).toBe("NORMAL");
    expect(kitchenWaitLevel(5, 5, 10)).toBe("WARNING");
    expect(kitchenWaitLevel(10, 5, 10)).toBe("CRITICAL");
  });

  it("aggregates identical items per station and modifier set", () => {
    const result = aggregateKitchenItems([
      task(),
      task({ id: "task-2", orderId: "order-2", orderItemId: "item-2", quantity: 3, modifiers: ["小辣", "加蛋"] }),
      task({ id: "task-3", orderItemId: "item-3", quantity: 1, modifiers: ["不辣"] }),
      task({ id: "task-4", orderItemId: "item-4", quantity: 4, itemNote: "不要切", modifiers: ["小辣", "加蛋"] }),
      task({ id: "task-5", orderItemId: "item-5", quantity: 2, orderNote: "整單不加醬", modifiers: ["小辣", "加蛋"] }),
    ]);
    expect(result).toHaveLength(4);
    expect(result.find((item) => (
      item.modifiers.includes("加蛋") && item.itemNote === null && item.orderNote === null
    ))?.quantity).toBe(5);
    expect(result.find((item) => item.itemNote === "不要切")?.quantity).toBe(4);
    expect(result.find((item) => item.orderNote === "整單不加醬")?.quantity).toBe(2);
  });

  it("permits only explicit task transitions and controlled rollback", () => {
    expect(canTransitionKitchenTask("PENDING", "PREPARING")).toBe(true);
    expect(canTransitionKitchenTask("PREPARING", "COMPLETED")).toBe(true);
    expect(canTransitionKitchenTask("COMPLETED", "PENDING")).toBe(true);
    expect(canTransitionKitchenTask("PENDING", "COMPLETED")).toBe(false);
    expect(canTransitionKitchenTask("CANCELLED", "PENDING")).toBe(false);
  });

  it("never moves the shared order state backwards during task correction", () => {
    expect(preserveKitchenOrderProgress("PREPARING", "CONFIRMED")).toBe("PREPARING");
    expect(preserveKitchenOrderProgress("PACKING", "PREPARING")).toBe("PACKING");
    expect(preserveKitchenOrderProgress("CONFIRMED", "READY")).toBe("READY");
  });

  it("distinguishes time until a reservation from minutes overdue", () => {
    const now = Date.parse("2026-08-13T04:00:00.000Z");
    expect(kitchenWaitDisplay(now, now + 61_000, now - 10 * 60_000)).toEqual({
      elapsedMinutes: 0,
      label: "距預約 2 分",
      beforeFulfillment: true,
    });
    expect(kitchenWaitDisplay(now, now - 5 * 60_000, now - 10 * 60_000)).toEqual({
      elapsedMinutes: 5,
      label: "已逾預約 5 分",
      beforeFulfillment: false,
    });
    expect(kitchenWaitDisplay(now, null, now - 10 * 60_000)).toEqual({
      elapsedMinutes: 10,
      label: "已等待 10 分",
      beforeFulfillment: false,
    });
  });

  it("keeps future reservations off today's production task list", () => {
    const result = partitionKitchenTasksByFulfillmentDate([
      task({ id: "due", committedFulfillmentAt: "2026-08-13T04:00:00.000Z" }),
      task({ id: "future", committedFulfillmentAt: "2026-08-14T04:00:00.000Z" }),
      task({ id: "asap" }),
    ], {
      timeZone: "Asia/Taipei",
      businessDayCutoffHour: 3,
      now: new Date("2026-08-13T04:00:00.000Z"),
    });
    expect(result.currentTasks.map((entry) => entry.id)).toEqual(["due", "asap"]);
    expect(result.futureReservations.map((entry) => entry.id)).toEqual(["future"]);
  });

  it("keeps already-started future work visible for completion and correction", () => {
    const future = "2026-08-14T04:00:00.000Z";
    const result = partitionKitchenTasksByFulfillmentDate([
      task({ id: "pending", committedFulfillmentAt: future }),
      task({ id: "task-started", committedFulfillmentAt: future, status: "PREPARING" }),
      task({ id: "order-started", committedFulfillmentAt: future, orderStatus: "PREPARING" }),
      task({ id: "packing", committedFulfillmentAt: future, orderStatus: "PACKING" }),
    ], {
      timeZone: "Asia/Taipei",
      businessDayCutoffHour: 3,
      now: new Date("2026-08-13T04:00:00.000Z"),
    });
    expect(result.futureReservations.map((entry) => entry.id)).toEqual(["pending"]);
    expect(result.currentTasks.map((entry) => entry.id)).toEqual([
      "task-started",
      "order-started",
      "packing",
    ]);
  });
});
