import type { StaffOrderDto } from "@/lib/orders";
import { describe, expect, it, vi } from "vitest";
import {
  createStaffOrderRefreshController,
  loadStaffOrderSnapshot,
  mergeStaffOrders,
} from "./staff-order-board-refresh";

describe("StaffOrderBoard refresh controller", () => {
  it("coalesces overlapping refreshes and applies only the newest snapshot", async () => {
    const pending: Array<(value: string) => void> = [];
    const load = vi.fn(() => new Promise<string>((resolve) => pending.push(resolve)));
    const apply = vi.fn();
    const controller = createStaffOrderRefreshController<string>();

    const first = controller.request({ silent: true, load, apply });
    const second = controller.request({ silent: true, load, apply });
    const third = controller.request({ silent: true, load, apply });

    expect(load).toHaveBeenCalledTimes(1);
    pending.shift()?.("stale");
    await flushMicrotasks();

    expect(apply).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);

    pending.shift()?.("current");
    await Promise.all([first, second, third]);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("current");
  });

  it("keeps a manual refresh busy through a queued refresh and reports only its current error", async () => {
    const pending: Array<{
      resolve: (value: string) => void;
      reject: (error: Error) => void;
    }> = [];
    const load = vi.fn(() => new Promise<string>((resolve, reject) => pending.push({ resolve, reject })));
    const onManualRefreshStart = vi.fn();
    const onRefreshingChange = vi.fn();
    const onError = vi.fn();
    const controller = createStaffOrderRefreshController<string>();
    const request = {
      load,
      apply: vi.fn(),
      onManualRefreshStart,
      onRefreshingChange,
      onError,
    };

    const first = controller.request(request);
    const second = controller.request({ ...request, silent: true });
    expect(onManualRefreshStart).toHaveBeenCalledTimes(1);
    expect(onRefreshingChange).toHaveBeenCalledWith(true);

    pending.shift()?.resolve("stale");
    await flushMicrotasks();
    pending.shift()?.reject(new Error("latest failed"));
    await Promise.all([first, second]);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "latest failed" });
    expect(onRefreshingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does not commit a snapshot after disposal", async () => {
    let resolve!: (value: string) => void;
    const apply = vi.fn();
    const controller = createStaffOrderRefreshController<string>();

    const refresh = controller.request({
      silent: true,
      load: () => new Promise<string>((next) => { resolve = next; }),
      apply,
    });
    controller.dispose();
    resolve("late");
    await refresh;

    expect(apply).not.toHaveBeenCalled();
  });
});

describe("StaffOrderBoard authoritative snapshot", () => {
  it("fetches without cache and merges unsynchronized offline orders by creation time", async () => {
    const onlineA = staffOrder("online-a", "2026-08-13T01:00:00.000Z", "PUBLIC_QR");
    const onlineB = staffOrder("shared", "2026-08-13T03:00:00.000Z", "PUBLIC_QR");
    const offline = staffOrder("shared", "2026-08-13T02:00:00.000Z", "OFFLINE_POS");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      orders: [onlineA, onlineB],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const snapshot = await loadStaffOrderSnapshot({
      stallId: "stall-id",
      stallSlug: "stall-slug",
      fetchImpl,
      loadOfflineOrders: async () => [offline],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/stalls/stall-slug/orders",
      { cache: "no-store" },
    );
    expect(snapshot.onlineOrders).toEqual([onlineA, onlineB]);
    expect(snapshot.mergedOrders).toEqual([onlineA, offline]);
  });

  it("uses the server error from a failed authoritative fetch", async () => {
    await expect(loadStaffOrderSnapshot({
      stallId: "stall-id",
      stallSlug: "stall-slug",
      fetchImpl: async () => new Response(JSON.stringify({ error: "server said no" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
      loadOfflineOrders: async () => [],
    })).rejects.toThrow("server said no");
  });

  it("keeps the existing offline-wins merge contract", () => {
    const online = staffOrder("same", "2026-08-13T03:00:00.000Z", "PUBLIC_QR");
    const offline = staffOrder("same", "2026-08-13T02:00:00.000Z", "OFFLINE_POS");

    expect(mergeStaffOrders([online], [offline])).toEqual([offline]);
  });
});

function staffOrder(id: string, createdAt: string, source: StaffOrderDto["source"]) {
  return { id, createdAt, source } as StaffOrderDto;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
