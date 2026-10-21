import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveResourceRetryError } from "@/lib/use-live-resource";
import { startKitchenBoardLiveLifecycle, type KitchenBoardLiveEnvironment } from "./kitchen-board-live";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createEnvironment() {
  let online = true;
  let visible: DocumentVisibilityState = "visible";
  const listeners = new Set<() => void>();
  const sourceListeners = new Map<string, Set<(event: Event) => void>>();
  const source = {
    onerror: null as ((event: Event) => void) | null,
    addEventListener(type: "ready" | "kitchen", listener: (event: Event) => void) {
      const group = sourceListeners.get(type) ?? new Set();
      group.add(listener);
      sourceListeners.set(type, group);
    },
    close: vi.fn(() => sourceListeners.clear()),
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const environment: KitchenBoardLiveEnvironment = {
    visibilityState: () => visible,
    online: () => online,
    scheduleTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
    cancelTimeout: (timer) => clearTimeout(timer),
    onVisibilityChange: subscribe,
    onOnline: subscribe,
    onOffline: subscribe,
    supportsEventSource: () => true,
    createEventSource: () => source,
  };
  return {
    environment,
    source,
    emit(type: "ready" | "kitchen") { sourceListeners.get(type)?.forEach((listener) => listener(new Event(type))); },
    setOnline(value: boolean) { online = value; listeners.forEach((listener) => listener()); },
    setVisible(value: DocumentVisibilityState) { visible = value; listeners.forEach((listener) => listener()); },
    listenerCount: () => listeners.size + [...sourceListeners.values()].reduce((sum, group) => sum + group.size, 0),
  };
}

async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

describe("kitchen board live lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("ready closes the initial snapshot gap without publishing the old response", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const first = deferred<string>(); const latest = deferred<string>();
    const requests = [first, latest];
    const applied: string[] = [];
    let active = 0;
    let maxConcurrentLoads = 0;
    const controller = startKitchenBoardLiveLifecycle({ stallSlug: "a", environment: browser.environment,
      load: () => { active++; maxConcurrentLoads = Math.max(active, maxConcurrentLoads); return requests.shift()!.promise.finally(() => { active--; }); },
      onData: (value) => applied.push(value), onConnectionChange: vi.fn() });
    browser.emit("ready");
    first.resolve("before stream opened"); await flush();
    latest.resolve("after stream opened"); await flush();
    expect(applied).toEqual(["after stream opened"]);
    controller.stop();
    expect(maxConcurrentLoads).toBe(1);
  });

  it("burst invalidations coalesce and only apply the latest snapshot", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const first = deferred<string>(); const latest = deferred<string>();
    const pending = [first, latest];
    const applied: string[] = [];
    let active = 0; let maxConcurrentLoads = 0;
    const load = vi.fn(() => {
      active++; maxConcurrentLoads = Math.max(active, maxConcurrentLoads);
      return pending.shift()!.promise.finally(() => { active--; });
    });
    const controller = startKitchenBoardLiveLifecycle({ stallSlug: "a", environment: browser.environment,
      load, onData: (value) => applied.push(value), onConnectionChange: vi.fn() });
    browser.emit("ready"); browser.emit("kitchen"); browser.emit("kitchen");
    first.resolve("stale"); await flush();
    expect(load).toHaveBeenCalledTimes(2);
    latest.resolve("latest"); await flush();
    expect(applied).toEqual(["latest"]);
    expect(maxConcurrentLoads).toBe(1);
    controller.stop();
  });

  it("stopped old store cannot publish and cleans up listeners", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const pending = deferred<string>();
    let oldRequestSignal!: AbortSignal;
    const applied: string[] = [];
    const controller = startKitchenBoardLiveLifecycle({ stallSlug: "a", environment: browser.environment,
      load: (signal) => { oldRequestSignal = signal; return pending.promise; },
      onData: (value) => applied.push(value), onConnectionChange: vi.fn() });
    controller.stop();
    pending.resolve("old stall"); await flush();
    expect(applied).toEqual([]);
    expect(browser.listenerCount()).toBe(0);
    expect(browser.source.close).toHaveBeenCalledOnce();
    expect(oldRequestSignal.aborted).toBe(true);
  });

  it("offline aborts and online refreshes", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const first = deferred<string>();
    const signals: AbortSignal[] = [];
    const applied: string[] = [];
    const controller = startKitchenBoardLiveLifecycle({ stallSlug: "a", environment: browser.environment,
      load: (signal) => { signals.push(signal); return signals.length === 1 ? first.promise : Promise.resolve("online"); },
      onData: (value) => applied.push(value), onConnectionChange: vi.fn() });
    browser.setOnline(false);
    expect(signals[0].aborted).toBe(true);
    first.resolve("offline"); await flush();
    browser.setOnline(true); await flush();
    expect(applied).toEqual(["online"]);
    controller.stop();
  });

  it("retry-after bounds new fetches", async () => {
    vi.useFakeTimers();
    const browser = createEnvironment();
    const load = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new LiveResourceRetryError("busy", 5_000))
      .mockResolvedValue("recovered");
    const applied: string[] = [];
    const controller = startKitchenBoardLiveLifecycle({ stallSlug: "a", environment: browser.environment,
      load, onData: (value) => applied.push(value), onConnectionChange: vi.fn() });
    await flush(); browser.emit("kitchen");
    vi.advanceTimersByTime(4_999); await flush();
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); await flush();
    expect(applied).toEqual(["recovered"]);
    controller.stop();
  });
});
