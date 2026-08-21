import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startStaffOrderLiveLifecycle,
  type StaffOrderLiveEnvironment,
  type StaffOrderLiveEventSource,
  type StaffOrderRealtimeSubscriptionInput,
} from "./staff-order-board-live";

describe("StaffOrderBoard shared live lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses SSE as primary and keeps the shared thirty-second safety refresh", async () => {
    vi.useFakeTimers();
    const fixture = liveFixture();
    const load = vi.fn(async () => `snapshot-${load.mock.calls.length}`);
    const onData = vi.fn();
    const refreshBackendAvailability = vi.fn();
    const onConnectionChange = vi.fn();
    const controller = startStaffOrderLiveLifecycle({
      stallId: "stall-id",
      stallSlug: "stall-slug",
      environment: fixture.environment,
      load,
      onData,
      refreshBackendAvailability,
      onConnectionChange,
    });

    await flushMicrotasks();
    expect(fixture.eventSourceUrl).toBe("/api/stalls/stall-slug/orders/stream");
    expect(load).toHaveBeenCalledTimes(1);

    fixture.eventSource?.onopen?.(new Event("open"));
    await flushMicrotasks();
    expect(onConnectionChange).toHaveBeenLastCalledWith("sse");
    expect(refreshBackendAvailability).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);

    fixture.emitOrders();
    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(4);

    controller.stop();
    expect(fixture.eventSource?.close).toHaveBeenCalledTimes(1);
    expect(fixture.listenerCount()).toBe(0);
    fixture.emitOrders();
    vi.advanceTimersByTime(30_000);
    expect(load).toHaveBeenCalledTimes(4);
    expect(onData).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back from SSE to Realtime and then to five-second polling", async () => {
    vi.useFakeTimers();
    const fixture = liveFixture();
    const load = vi.fn(async () => `snapshot-${load.mock.calls.length}`);
    const refreshBackendAvailability = vi.fn();
    const onConnectionChange = vi.fn();
    const controller = startStaffOrderLiveLifecycle({
      stallId: "stall-id",
      stallSlug: "stall-slug",
      environment: fixture.environment,
      load,
      onData: vi.fn(),
      refreshBackendAvailability,
      onConnectionChange,
    });
    await flushMicrotasks();

    fixture.eventSource?.onerror?.(new Event("error"));
    await flushMicrotasks();
    expect(fixture.connectRealtime).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(4_000);
    expect(onConnectionChange).toHaveBeenLastCalledWith("polling");
    vi.advanceTimersByTime(1_000);
    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(3);

    fixture.realtimeInput?.onStatus("SUBSCRIBED");
    await flushMicrotasks();
    expect(onConnectionChange).toHaveBeenLastCalledWith("realtime");
    expect(refreshBackendAvailability).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(4);

    vi.advanceTimersByTime(10_000);
    expect(load).toHaveBeenCalledTimes(4);
    fixture.realtimeInput?.onOrdersChanged();
    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(5);

    fixture.realtimeInput?.onStatus("CHANNEL_ERROR");
    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(4_000);
    expect(onConnectionChange).toHaveBeenLastCalledWith("polling");
    controller.stop();
  });

  it("pauses while hidden or offline, aborts stale work, and reconnects cleanly", async () => {
    vi.useFakeTimers();
    const fixture = liveFixture();
    const pending: Array<(value: string) => void> = [];
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>((resolve) => pending.push(resolve));
    });
    const onData = vi.fn();
    const onConnectionChange = vi.fn();
    const controller = startStaffOrderLiveLifecycle({
      stallId: "stall-id",
      stallSlug: "stall-slug",
      environment: fixture.environment,
      load,
      onData,
      refreshBackendAvailability: vi.fn(),
      onConnectionChange,
    });

    expect(load).toHaveBeenCalledTimes(1);
    fixture.setVisibility("hidden");
    expect(signals[0]?.aborted).toBe(true);
    expect(fixture.eventSource?.close).toHaveBeenCalledTimes(1);
    pending.shift()?.("hidden-stale");
    await flushMicrotasks();
    expect(onData).not.toHaveBeenCalled();

    fixture.setVisibility("visible");
    expect(load).toHaveBeenCalledTimes(2);
    fixture.setOnline(false);
    expect(signals[1]?.aborted).toBe(true);
    expect(onConnectionChange).toHaveBeenLastCalledWith("connecting");
    pending.shift()?.("offline-stale");
    await flushMicrotasks();
    expect(onData).not.toHaveBeenCalled();

    fixture.setOnline(true);
    expect(load).toHaveBeenCalledTimes(3);
    pending.shift()?.("current");
    await flushMicrotasks();
    expect(onData).toHaveBeenCalledWith("current", undefined);
    expect(fixture.eventSourceCount).toBe(3);

    controller.stop();
    expect(fixture.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces an event burst into one queued authoritative refresh", async () => {
    vi.useFakeTimers();
    const fixture = liveFixture();
    const pending: Array<(value: string) => void> = [];
    const load = vi.fn(() => new Promise<string>((resolve) => pending.push(resolve)));
    const onData = vi.fn();
    const controller = startStaffOrderLiveLifecycle({
      stallId: "stall-id",
      stallSlug: "stall-slug",
      environment: fixture.environment,
      load,
      onData,
      refreshBackendAvailability: vi.fn(),
      onConnectionChange: vi.fn(),
    });

    for (let index = 0; index < 100; index += 1) fixture.emitOrders();
    expect(load).toHaveBeenCalledTimes(1);

    pending.shift()?.("initial");
    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(2);
    pending.shift()?.("latest");
    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(2);
    expect(onData.mock.calls).toEqual([
      ["initial", undefined],
      ["latest", 100],
    ]);

    controller.stop();
    fixture.emitOrders();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("disposes a late Realtime subscription instead of replacing recovered SSE", async () => {
    vi.useFakeTimers();
    let resolveRealtime!: (remove: () => void) => void;
    const removeRealtime = vi.fn();
    const fixture = liveFixture({
      connectRealtime: (input) => {
        fixture.realtimeInput = input;
        return new Promise((resolve) => { resolveRealtime = resolve; });
      },
    });
    const onConnectionChange = vi.fn();
    const controller = startStaffOrderLiveLifecycle({
      stallId: "stall-id",
      stallSlug: "stall-slug",
      environment: fixture.environment,
      load: async () => "snapshot",
      onData: vi.fn(),
      refreshBackendAvailability: vi.fn(),
      onConnectionChange,
    });

    fixture.eventSource?.onerror?.(new Event("error"));
    fixture.eventSource?.onopen?.(new Event("open"));
    expect(onConnectionChange).toHaveBeenLastCalledWith("sse");

    resolveRealtime(removeRealtime);
    await flushMicrotasks();
    fixture.realtimeInput?.onStatus("SUBSCRIBED");

    expect(removeRealtime).toHaveBeenCalledTimes(1);
    expect(onConnectionChange).toHaveBeenLastCalledWith("sse");
    controller.stop();
  });
});

function liveFixture(overrides: Partial<StaffOrderLiveEnvironment> = {}) {
  let visibility: DocumentVisibilityState = "visible";
  let online = true;
  let orderListeners = new Set<(event: Event) => void>();
  const visibilityListeners = new Set<() => void>();
  const onlineListeners = new Set<() => void>();
  const offlineListeners = new Set<() => void>();
  const fixture = {
    eventSource: null as StaffOrderLiveEventSource | null,
    eventSourceCount: 0,
    eventSourceUrl: "",
    realtimeInput: undefined as StaffOrderRealtimeSubscriptionInput | undefined,
    connectRealtime: vi.fn(async (input: StaffOrderRealtimeSubscriptionInput) => {
      fixture.realtimeInput = input;
      return vi.fn();
    }),
    emitOrders: () => orderListeners.forEach((listener) => listener(new Event("orders"))),
    setVisibility(value: DocumentVisibilityState) {
      visibility = value;
      visibilityListeners.forEach((listener) => listener());
    },
    setOnline(value: boolean) {
      online = value;
      const listeners = value ? onlineListeners : offlineListeners;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => (
      visibilityListeners.size + onlineListeners.size + offlineListeners.size
    ),
    environment: undefined as unknown as StaffOrderLiveEnvironment,
  };
  fixture.environment = {
    supportsEventSource: () => true,
    createEventSource: (url) => {
      orderListeners = new Set();
      fixture.eventSourceUrl = url;
      fixture.eventSourceCount += 1;
      fixture.eventSource = {
        onopen: null,
        onerror: null,
        addEventListener: (type, listener) => {
          if (type === "orders") orderListeners.add(listener);
        },
        close: vi.fn(),
      };
      return fixture.eventSource;
    },
    connectRealtime: (input) => fixture.connectRealtime(input),
    scheduleInterval: (callback, intervalMs) => setInterval(callback, intervalMs) as unknown as number,
    cancelInterval: (timer) => clearInterval(timer),
    scheduleTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs) as unknown as number,
    cancelTimeout: (timer) => clearTimeout(timer),
    visibilityState: () => visibility,
    online: () => online,
    onVisibilityChange: (listener) => {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    onOnline: (listener) => {
      onlineListeners.add(listener);
      return () => onlineListeners.delete(listener);
    },
    onOffline: (listener) => {
      offlineListeners.add(listener);
      return () => offlineListeners.delete(listener);
    },
    ...overrides,
  };
  return fixture;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
