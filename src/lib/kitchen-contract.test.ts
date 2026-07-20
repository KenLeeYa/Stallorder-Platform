import { describe, expect, it } from "vitest";
import {
  aggregateKitchenItems,
  canTransitionKitchenTask,
  kitchenWaitLevel,
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
});
