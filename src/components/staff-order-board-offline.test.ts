import { describe, expect, it, vi } from "vitest";
import type { StaffOrderDto } from "@/lib/orders";
import type { OfflineOrder } from "@/offline/offline-order-contract";
import {
  loadOfflineStaffOrders,
  mergeStaffOfflineOrderIntake,
  refreshStaffOrdersAfterOfflineSync,
  startStaffOrderOfflineIntake,
  type StaffOrderOfflineEnvironment,
} from "./staff-order-board-offline";

describe("StaffOrderBoard offline orchestration", () => {
  it("loads only visible unsynchronized orders and keeps the existing fail-soft contract", async () => {
    const active = offlineOrder("active", "LOCAL_READY");
    const completed = offlineOrder("completed", "LOCAL_COMPLETED");
    const cancelled = offlineOrder("cancelled", "LOCAL_CANCELLED");
    const listUnsynchronizedOfflineOrders = vi.fn(async () => [active, completed, cancelled]);
    const offlineOrderToStaffOrder = vi.fn((order: OfflineOrder) => (
      staffOrder(order.offlineOrderId, order.createdAtDevice, "OFFLINE_POS")
    ));

    await expect(loadOfflineStaffOrders("stall-1", {
      indexedDbAvailable: () => true,
      loadDependencies: async () => ({
        listUnsynchronizedOfflineOrders,
        offlineOrderToStaffOrder,
      }),
    })).resolves.toEqual([
      staffOrder("active", active.createdAtDevice, "OFFLINE_POS"),
    ]);
    expect(listUnsynchronizedOfflineOrders).toHaveBeenCalledWith("stall-1");
    expect(offlineOrderToStaffOrder).toHaveBeenCalledTimes(1);

    const loadDependencies = vi.fn(async () => {
      throw new Error("IndexedDB unavailable");
    });
    await expect(loadOfflineStaffOrders("stall-1", {
      indexedDbAvailable: () => true,
      loadDependencies,
    })).resolves.toEqual([]);
    await expect(loadOfflineStaffOrders("stall-1", {
      indexedDbAvailable: () => false,
      loadDependencies,
    })).resolves.toEqual([]);
    expect(loadDependencies).toHaveBeenCalledTimes(1);
  });

  it("replaces the previous local intake while retaining online orders and offline-wins IDs", () => {
    const oldOffline = staffOrder("old-offline", "2026-08-13T01:00:00.000Z", "OFFLINE_POS");
    const online = staffOrder("same", "2026-08-13T02:00:00.000Z", "PUBLIC_QR");
    const offline = staffOrder("same", "2026-08-13T03:00:00.000Z", "OFFLINE_POS");

    expect(mergeStaffOfflineOrderIntake([oldOffline, online], [offline])).toEqual([offline]);
  });

  it("loads on startup and reloads when offline data changes", async () => {
    const initial = staffOrder("offline-1", "2026-08-13T01:00:00.000Z", "OFFLINE_POS");
    const next = staffOrder("offline-2", "2026-08-13T02:00:00.000Z", "OFFLINE_POS");
    const loads = [[initial], [next]];
    const loadOrders = vi.fn(async () => loads.shift() ?? []);
    const subscription = createSubscription(loadOrders);
    const knownOrderIds = new Set<string>();
    let orders = [staffOrder("online", "2026-08-13T00:00:00.000Z", "PUBLIC_QR")];

    const dispose = startStaffOrderOfflineIntake({
      stallId: "stall-1",
      knownOrderIds,
      updateOrders: (update) => { orders = update(orders); },
      environment: subscription.environment,
    });

    await vi.waitFor(() => expect(loadOrders).toHaveBeenCalledTimes(1));
    expect(orders.map((order) => order.id)).toEqual(["online", "offline-1"]);
    expect(knownOrderIds).toEqual(new Set(["offline-1"]));

    subscription.trigger();
    await vi.waitFor(() => expect(loadOrders).toHaveBeenCalledTimes(2));
    expect(orders.map((order) => order.id)).toEqual(["online", "offline-2"]);
    expect(knownOrderIds).toEqual(new Set(["offline-1", "offline-2"]));

    dispose();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not apply an IndexedDB result after disposal", async () => {
    let resolveLoad!: (orders: StaffOrderDto[]) => void;
    const loadOrders = vi.fn(() => new Promise<StaffOrderDto[]>((resolve) => {
      resolveLoad = resolve;
    }));
    const subscription = createSubscription(loadOrders);
    const updateOrders = vi.fn();
    const knownOrderIds = new Set<string>();

    const dispose = startStaffOrderOfflineIntake({
      stallId: "stall-1",
      knownOrderIds,
      updateOrders,
      environment: subscription.environment,
    });
    dispose();
    resolveLoad([staffOrder("late", "2026-08-13T01:00:00.000Z", "OFFLINE_POS")]);
    await Promise.resolve();
    await Promise.resolve();

    expect(updateOrders).not.toHaveBeenCalled();
    expect(knownOrderIds).toEqual(new Set());
  });

  it("uses a silent authoritative refresh after synchronization and awaits completion", async () => {
    let resolveRefresh!: () => void;
    const refreshOrders = vi.fn(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));
    const completion = refreshStaffOrdersAfterOfflineSync(refreshOrders);

    expect(refreshOrders).toHaveBeenCalledWith(true);
    let completed = false;
    void completion.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    resolveRefresh();
    await completion;
    expect(completed).toBe(true);
  });
});

function createSubscription(loadOrders: () => Promise<StaffOrderDto[]>) {
  let listener: (() => void) | null = null;
  const unsubscribe = vi.fn();
  const environment: StaffOrderOfflineEnvironment = {
    loadOrders,
    subscribe: (nextListener) => {
      listener = nextListener;
      return unsubscribe;
    },
  };
  return {
    environment,
    unsubscribe,
    trigger: () => listener?.(),
  };
}

function staffOrder(
  id: string,
  createdAt: string,
  source: StaffOrderDto["source"],
) {
  return { id, createdAt, source } as StaffOrderDto;
}

function offlineOrder(id: string, orderStatus: OfflineOrder["orderStatus"]) {
  return {
    offlineOrderId: id,
    orderStatus,
    createdAtDevice: "2026-08-13T01:00:00.000Z",
  } as OfflineOrder;
}
