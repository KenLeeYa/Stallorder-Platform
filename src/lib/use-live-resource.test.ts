import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startLiveResource,
  type LiveResourceEnvironment,
} from "./use-live-resource";

function createEnvironment() {
  let visibility: DocumentVisibilityState = "visible";
  let online = true;
  const visibilityListeners = new Set<() => void>();
  const onlineListeners = new Set<() => void>();
  const offlineListeners = new Set<() => void>();
  const environment: LiveResourceEnvironment = {
    visibilityState: () => visibility,
    online: () => online,
    scheduleTimeout: (callback, delayMs) => (
      setTimeout(callback, delayMs) as unknown as number
    ),
    cancelTimeout: (timer) => clearTimeout(timer),
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
  };
  return {
    environment,
    listenerCount: () => (
      visibilityListeners.size + onlineListeners.size + offlineListeners.size
    ),
    setOnline(value: boolean) {
      online = value;
      const listeners = value ? onlineListeners : offlineListeners;
      listeners.forEach((listener) => listener());
    },
    setVisibility(value: DocumentVisibilityState) {
      visibility = value;
      visibilityListeners.forEach((listener) => listener());
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("live resource controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves visible/online polling and coalesces slow refreshes", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const pending: Array<(value: { value: number }) => void> = [];
    const signals: AbortSignal[] = [];
    const load = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise<{ value: number }>((resolve) => pending.push(resolve));
    });
    const onData = vi.fn();
    const onOnlineChange = vi.fn();
    const controller = startLiveResource({
      environment: browser.environment,
      intervalMs: 10_000,
      load,
      onData,
      onOnlineChange,
    });

    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(load).toHaveBeenCalledTimes(1);

    pending.shift()?.({ value: 1 });
    await flushPromises();
    expect(onData).toHaveBeenCalledWith(1, undefined);
    expect(load).toHaveBeenCalledTimes(2);

    browser.setVisibility("hidden");
    expect(signals[1].aborted).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(load).toHaveBeenCalledTimes(2);

    browser.setVisibility("visible");
    expect(load).toHaveBeenCalledTimes(3);
    browser.setOnline(false);
    expect(signals[2].aborted).toBe(true);
    expect(onOnlineChange).toHaveBeenLastCalledWith(false);

    browser.setOnline(true);
    expect(load).toHaveBeenCalledTimes(4);
    expect(onOnlineChange).toHaveBeenLastCalledWith(true);

    controller.stop();
    expect(signals[3].aborted).toBe(true);
    expect(browser.listenerCount()).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("does not load on a hidden initial render", () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    browser.setVisibility("hidden");
    const load = vi.fn(async () => ({ value: "ready" }));
    const controller = startLiveResource({
      environment: browser.environment,
      load,
      onData: vi.fn(),
    });

    expect(load).not.toHaveBeenCalled();
    browser.setVisibility("visible");
    expect(load).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("backs off failed refreshes and resets after success", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValue({ value: "ready" });
    const onData = vi.fn();
    const onError = vi.fn();
    const controller = startLiveResource({
      environment: browser.environment,
      intervalMs: 10_000,
      retryBaseMs: 1_000,
      maxBackoffMs: 4_000,
      load,
      onData,
      onError,
    });

    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1_999);
    expect(load).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(3);
    expect(onData).toHaveBeenLastCalledWith("ready", undefined);

    vi.advanceTimersByTime(9_999);
    expect(load).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(4);
    controller.stop();
  });

  it("drops duplicate and stale cursor results", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const results = [
      { value: "two", cursor: 2 },
      { value: "duplicate", cursor: 2 },
      { value: "stale", cursor: 1 },
      { value: "three", cursor: 3 },
    ];
    const onData = vi.fn();
    const controller = startLiveResource({
      environment: browser.environment,
      load: vi.fn(async () => results.shift()!),
      onData,
    });

    await flushPromises();
    await controller.refresh();
    await controller.refresh();
    await controller.refresh();

    expect(onData.mock.calls).toEqual([
      ["two", 2],
      ["three", 3],
    ]);
    controller.stop();
  });

  it("accepts an injected live adapter and deduplicates its cursors", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const adapterState: {
      emit?: (cursor: number) => void;
      signal?: AbortSignal;
    } = {};
    const unsubscribe = vi.fn();
    const adapter = vi.fn((input: {
      signal: AbortSignal;
      onEvent: (cursor: number) => void;
    }) => {
      adapterState.signal = input.signal;
      adapterState.emit = input.onEvent;
      return unsubscribe;
    });
    const load = vi.fn()
      .mockResolvedValueOnce({ value: "one", cursor: 1 })
      .mockResolvedValueOnce({ value: "two", cursor: 2 });
    const onData = vi.fn();
    const controller = startLiveResource({
      environment: browser.environment,
      adapter,
      load,
      onData,
    });

    await flushPromises();
    adapterState.emit?.(1);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);

    adapterState.emit?.(2);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    adapterState.emit?.(2);
    adapterState.emit?.(1);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    expect(onData.mock.calls).toEqual([["one", 1], ["two", 2]]);

    controller.stop();
    expect(adapterState.signal?.aborted).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps an explicit refresh pending until its queued authoritative load finishes", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const pending: Array<(value: { value: string }) => void> = [];
    const load = vi.fn(() => (
      new Promise<{ value: string }>((resolve) => pending.push(resolve))
    ));
    const controller = startLiveResource({
      environment: browser.environment,
      load,
      onData: vi.fn(),
    });
    let refreshFinished = false;

    const refresh = controller.refresh().then(() => { refreshFinished = true; });
    expect(load).toHaveBeenCalledTimes(1);
    pending.shift()?.({ value: "stale" });
    await flushPromises();

    expect(load).toHaveBeenCalledTimes(2);
    expect(refreshFinished).toBe(false);
    pending.shift()?.({ value: "current" });
    await refresh;
    expect(refreshFinished).toBe(true);
    controller.stop();
  });

  it("aborts and suppresses late data during teardown", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const loadState: {
      resolve?: (value: { value: string }) => void;
      signal?: AbortSignal;
    } = {};
    const onData = vi.fn();
    const controller = startLiveResource({
      environment: browser.environment,
      load: ({ signal: nextSignal }) => {
        loadState.signal = nextSignal;
        return new Promise<{ value: string }>((resolve) => {
          loadState.resolve = resolve;
        });
      },
      onData,
    });

    controller.stop();
    expect(loadState.signal?.aborted).toBe(true);
    loadState.resolve?.({ value: "late" });
    await flushPromises();
    expect(onData).not.toHaveBeenCalled();
    expect(browser.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
