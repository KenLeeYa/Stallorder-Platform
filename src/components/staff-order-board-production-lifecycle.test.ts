import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";
import type { StaffOrderUndoBatch } from "./staff-order-board-batch";
import {
  createStaffOrderProductionLifecycle,
  reconcileStaffOrderProductionSelection,
  replaceStaffOrderProductionOrders,
  type StaffOrderProductionLifecycleDependencies,
} from "./staff-order-board-production-lifecycle";
import type { StaffOrderDto } from "@/lib/orders";

describe("StaffOrderBoard production lifecycle", () => {
  it("applies authoritative order results and always releases order busy state", async () => {
    const original = staffOrder("order-1", ["item-1"]);
    const authoritative = { ...original, status: "CONFIRMED" } as StaffOrderDto;
    const harness = createHarness([original]);
    const dependencies = createDependencies({
      transitionOrder: vi.fn(async () => ({
        kind: "replace" as const,
        order: authoritative,
        message: "離線製作狀態已安全儲存在此裝置。",
      })),
    });
    const lifecycle = createStaffOrderProductionLifecycle(harness.bindings, dependencies);

    await expect(lifecycle.updateOrder("order-1", "CONFIRMED")).resolves.toBe(true);

    expect(harness.state.orders).toEqual([authoritative]);
    expect(harness.history.updatingOrderId).toEqual(["order-1", null]);
    expect(harness.history.message).toEqual([
      "",
      "離線製作狀態已安全儲存在此裝置。",
    ]);

    dependencies.transitionOrder = vi.fn(async () => {
      throw new Error("訂單已由其他裝置更新。");
    });
    const failingLifecycle = createStaffOrderProductionLifecycle(harness.bindings, dependencies);
    await expect(failingLifecycle.updateOrder("order-1", "READY")).resolves.toBe(false);
    expect(harness.history.updatingOrderId.slice(-2)).toEqual(["order-1", null]);
    expect(harness.state.message).toBe("訂單已由其他裝置更新。");
  });

  it("keeps item and whole-order item busy/error/success behavior", async () => {
    const original = staffOrder("order-1", ["item-1"]);
    const itemUpdated = staffOrder("order-1", ["item-1"], "PREPARING");
    const harness = createHarness([original]);
    const dependencies = createDependencies({
      transitionItem: vi.fn(async () => ({ kind: "replace" as const, order: itemUpdated })),
      transitionAllItems: vi.fn(async () => ({
        kind: "remove" as const,
        orderId: "order-1",
        message: "離線訂單已在本機完成，恢復連線後會同步。",
      })),
    });
    const lifecycle = createStaffOrderProductionLifecycle(harness.bindings, dependencies);

    await lifecycle.updateItemStatus("order-1", "item-1", "PREPARING");
    expect(harness.state.orders).toEqual([itemUpdated]);
    expect(harness.history.updatingItemId).toEqual(["item-1", null]);

    await lifecycle.updateAllItemStatuses("order-1", "SERVED");
    expect(harness.state.orders).toEqual([]);
    expect(harness.history.updatingItemsOrderId).toEqual(["order-1", null]);
    expect(harness.state.message).toBe("離線訂單已在本機完成，恢復連線後會同步。");

    dependencies.transitionItem = vi.fn(async () => {
      throw "offline";
    });
    await createStaffOrderProductionLifecycle(harness.bindings, dependencies)
      .updateItemStatus("order-1", "item-1", "READY");
    expect(harness.state.message).toBe("網路連線中斷，請稍後再試。");
    expect(harness.history.updatingItemId.slice(-2)).toEqual(["item-1", null]);
  });

  it("updates and undoes batches with authoritative replacements", async () => {
    const original = staffOrder("order-1", ["item-1"]);
    const updated = staffOrder("order-1", ["item-1"], "READY");
    const undoBatch: StaffOrderUndoBatch = {
      actionId: "action-1",
      undoExpiresAt: "2026-08-13T08:05:00.000Z",
      itemCount: 1,
    };
    const harness = createHarness([original], new Set(["item-1"]));
    const dependencies = createDependencies({
      updateItemBatch: vi.fn(async () => ({ orders: [updated], undoBatch })),
      undoItemBatch: vi.fn(async () => [original]),
    });
    const lifecycle = createStaffOrderProductionLifecycle(harness.bindings, dependencies);

    await lifecycle.updateSelectedItems(["item-1"], "READY");
    expect(harness.state.orders).toEqual([updated]);
    expect(harness.state.selectedItemIds).toEqual(new Set());
    expect(harness.state.undoBatch).toEqual(undoBatch);
    expect(harness.history.batchBusy).toEqual([true, false]);

    await lifecycle.undoSelectedItems();
    expect(harness.state.orders).toEqual([original]);
    expect(harness.state.undoBatch).toBeNull();
    expect(harness.state.message).toBe("已復原上一筆批次餐點操作。");
    expect(harness.history.batchBusy).toEqual([true, false, true, false]);
  });

  it("clears failed undo metadata and reconciles selection to authoritative items", async () => {
    const order = staffOrder("order-1", ["item-1"]);
    const undoBatch: StaffOrderUndoBatch = {
      actionId: "action-1",
      undoExpiresAt: "2026-08-13T08:05:00.000Z",
      itemCount: 1,
    };
    const harness = createHarness(
      [order],
      new Set(["item-1", "removed-item"]),
      undoBatch,
    );
    const dependencies = createDependencies({
      undoItemBatch: vi.fn(async () => {
        throw new Error("復原期限已過。");
      }),
    });
    const lifecycle = createStaffOrderProductionLifecycle(harness.bindings, dependencies);

    lifecycle.reconcile([order]);
    expect(harness.state.selectedItemIds).toEqual(new Set(["item-1"]));
    lifecycle.toggleSelectedItem("item-2", true);
    lifecycle.toggleSelectedItem("item-1", false);
    expect(harness.state.selectedItemIds).toEqual(new Set(["item-2"]));
    lifecycle.clearSelectedItems();
    expect(harness.state.selectedItemIds).toEqual(new Set());

    await lifecycle.undoSelectedItems();
    expect(harness.state.undoBatch).toBeNull();
    expect(harness.state.message).toBe("復原期限已過。");
    expect(harness.history.batchBusy).toEqual([true, false]);
  });

  it("preserves selection and releases busy state when a batch update fails", async () => {
    const order = staffOrder("order-1", ["item-1"]);
    const harness = createHarness([order], new Set(["item-1"]));
    const dependencies = createDependencies({
      updateItemBatch: vi.fn(async () => {
        throw new Error("餐點狀態已由其他裝置更新。");
      }),
    });
    const lifecycle = createStaffOrderProductionLifecycle(harness.bindings, dependencies);

    await lifecycle.updateSelectedItems(["item-1"], "READY");

    expect(harness.state.orders).toEqual([order]);
    expect(harness.state.selectedItemIds).toEqual(new Set(["item-1"]));
    expect(harness.state.message).toBe("餐點狀態已由其他裝置更新。");
    expect(harness.history.batchBusy).toEqual([true, false]);
  });

  it("preserves board order and ignores absent authoritative batch rows", () => {
    const first = staffOrder("order-1", ["item-1"]);
    const second = staffOrder("order-2", ["item-2"]);
    const updatedSecond = staffOrder("order-2", ["item-2"], "READY");
    const absent = staffOrder("order-3", ["item-3"]);

    expect(replaceStaffOrderProductionOrders(
      [first, second],
      [updatedSecond, absent],
    )).toEqual([first, updatedSecond]);
    expect(reconcileStaffOrderProductionSelection(
      new Set(["item-1", "item-3"]),
      [first, second],
    )).toEqual(new Set(["item-1"]));
  });
});

function staffOrder(
  id: string,
  itemIds: string[],
  itemStatus: "PENDING" | "PREPARING" | "READY" | "SERVED" = "PENDING",
) {
  return {
    id,
    items: itemIds.map((itemId) => ({ id: itemId, status: itemStatus })),
  } as StaffOrderDto;
}

function createDependencies(
  overrides: Partial<StaffOrderProductionLifecycleDependencies> = {},
): StaffOrderProductionLifecycleDependencies {
  const order = staffOrder("order-1", ["item-1"]);
  return {
    transitionOrder: vi.fn(async () => ({ kind: "replace" as const, order })),
    transitionItem: vi.fn(async () => ({ kind: "replace" as const, order })),
    transitionAllItems: vi.fn(async () => ({ kind: "replace" as const, order })),
    updateItemBatch: vi.fn(async () => ({
      orders: [order],
      undoBatch: {
        actionId: "action-1",
        undoExpiresAt: "2026-08-13T08:05:00.000Z",
        itemCount: 1,
      },
    })),
    undoItemBatch: vi.fn(async () => [order]),
    ...overrides,
  };
}

function createHarness(
  initialOrders: StaffOrderDto[],
  initialSelectedItemIds = new Set<string>(),
  initialUndoBatch: StaffOrderUndoBatch | null = null,
) {
  const state = {
    orders: initialOrders,
    message: "initial",
    updatingOrderId: null as string | null,
    updatingItemId: null as string | null,
    updatingItemsOrderId: null as string | null,
    selectedItemIds: initialSelectedItemIds,
    batchBusy: false,
    undoBatch: initialUndoBatch,
  };
  const history = {
    message: [] as string[],
    updatingOrderId: [] as (string | null)[],
    updatingItemId: [] as (string | null)[],
    updatingItemsOrderId: [] as (string | null)[],
    batchBusy: [] as boolean[],
  };
  return {
    state,
    history,
    bindings: {
      stallSlug: "night-market",
      getOrders: () => state.orders,
      getUndoBatch: () => state.undoBatch,
      setOrders: (value: SetStateAction<StaffOrderDto[]>) => {
        state.orders = resolveState(value, state.orders);
      },
      setMessage: (message: string) => {
        state.message = message;
        history.message.push(message);
      },
      setUpdatingOrderId: (value: SetStateAction<string | null>) => {
        state.updatingOrderId = resolveState(value, state.updatingOrderId);
        history.updatingOrderId.push(state.updatingOrderId);
      },
      setUpdatingItemId: (value: SetStateAction<string | null>) => {
        state.updatingItemId = resolveState(value, state.updatingItemId);
        history.updatingItemId.push(state.updatingItemId);
      },
      setUpdatingItemsOrderId: (value: SetStateAction<string | null>) => {
        state.updatingItemsOrderId = resolveState(value, state.updatingItemsOrderId);
        history.updatingItemsOrderId.push(state.updatingItemsOrderId);
      },
      setSelectedItemIds: (value: SetStateAction<Set<string>>) => {
        state.selectedItemIds = resolveState(value, state.selectedItemIds);
      },
      setBatchBusy: (value: SetStateAction<boolean>) => {
        state.batchBusy = resolveState(value, state.batchBusy);
        history.batchBusy.push(state.batchBusy);
      },
      setUndoBatch: (value: SetStateAction<StaffOrderUndoBatch | null>) => {
        state.undoBatch = resolveState(value, state.undoBatch);
      },
    },
  };
}

function resolveState<T>(value: SetStateAction<T>, current: T) {
  return typeof value === "function"
    ? (value as (previous: T) => T)(current)
    : value;
}
