import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startLiveResource,
  type LiveResourceEnvironment,
  type LiveResourceLoadContext,
  type LiveResourceResult,
} from "@/lib/use-live-resource";

type TrackedOrder = { orderNo: string };

const trackerHarness = vi.hoisted(() => ({
  load: undefined as undefined | ((
    context: LiveResourceLoadContext<number>,
  ) => Promise<LiveResourceResult<TrackedOrder, number>>),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useState: <T,>(initial: T) => [initial, vi.fn()],
  };
});

vi.mock("@/lib/use-live-resource", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/use-live-resource")>();
  return {
    ...actual,
    useLiveResource: vi.fn((options: {
      load: typeof trackerHarness.load;
    }) => {
      trackerHarness.load = options.load;
      return { refresh: vi.fn(async () => undefined) };
    }),
  };
});

vi.mock("@/lib/public-order-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-order-client")>();
  return {
    ...actual,
    getOrCreateDeviceId: () => "11111111-1111-4111-8111-111111111111",
  };
});

import { PublicOrderTracker } from "./public-order-tracker";

function createEnvironment() {
  let visibility: DocumentVisibilityState = "visible";
  const visibilityListeners = new Set<() => void>();
  const environment: LiveResourceEnvironment = {
    visibilityState: () => visibility,
    online: () => true,
    scheduleTimeout: (callback, delayMs) => (
      setTimeout(callback, delayMs) as unknown as number
    ),
    cancelTimeout: (timer) => clearTimeout(timer),
    onVisibilityChange: (listener) => {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    onOnline: () => () => undefined,
    onOffline: () => () => undefined,
  };
  return {
    environment,
    setVisibility(next: DocumentVisibilityState) {
      visibility = next;
      visibilityListeners.forEach((listener) => listener());
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("public order tracker request cancellation", () => {
  afterEach(() => {
    trackerHarness.load = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("aborts the underlying fetch when hidden, then refreshes without overlap or stale apply", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL",
      "https://project.supabase.co/functions/v1/",
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const delayedRequests: Array<{
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "/api/availability/config") {
        return Promise.resolve(Response.json({ orderIntake: "DUAL" }));
      }
      if (url.endsWith("/get-public-order")) {
        const signal = init?.signal;
        if (!signal) return Promise.reject(new Error("missing request signal"));
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        return new Promise<Response>((resolve, reject) => {
          let settled = false;
          const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            activeRequests -= 1;
            callback();
          };
          signal.addEventListener("abort", () => {
            finish(() => reject(signal.reason));
          }, { once: true });
          delayedRequests.push({
            signal,
            resolve: (response) => finish(() => resolve(response)),
          });
        });
      }
      return Promise.reject(new Error(`unexpected fallback request: ${url}`));
    });
    vi.stubGlobal("fetch", fetchImpl);

    PublicOrderTracker({ trackingToken: "sto_tracker" });
    expect(trackerHarness.load).toBeTypeOf("function");
    const browser = createEnvironment();
    const onData = vi.fn();
    const onError = vi.fn();
    const controller = startLiveResource<TrackedOrder, number>({
      environment: browser.environment,
      intervalMs: 60_000,
      load: trackerHarness.load!,
      onData,
      onError,
    });
    await vi.waitFor(() => expect(delayedRequests).toHaveLength(1));

    browser.setVisibility("hidden");
    await flushPromises();
    const firstRequestWasAborted = delayedRequests[0].signal.aborted;

    browser.setVisibility("visible");
    await vi.waitFor(() => expect(delayedRequests).toHaveLength(2));
    delayedRequests[1].resolve(Response.json({ order: { orderNo: "fresh" } }));
    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(1));

    delayedRequests[0].resolve(Response.json({ order: { orderNo: "stale" } }));
    await flushPromises();
    controller.stop();

    expect(firstRequestWasAborted).toBe(true);
    expect(maxActiveRequests).toBe(1);
    expect(onData).toHaveBeenCalledWith({ orderNo: "fresh" }, undefined);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(requestedUrls).not.toContain("/api/public/orders/sto_tracker");
  });
});
