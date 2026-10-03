import {
  startLiveResource,
  type LiveResourceController,
  type LiveResourceEnvironment,
} from "@/lib/use-live-resource";

export type KitchenBoardConnection = "CONNECTING" | "CONNECTED" | "FALLBACK";

export type KitchenBoardEventSource = {
  onerror: ((event: Event) => void) | null;
  addEventListener: (type: "ready" | "kitchen", listener: (event: Event) => void) => void;
  close: () => void;
};

export type KitchenBoardLiveEnvironment = LiveResourceEnvironment & {
  supportsEventSource: () => boolean;
  createEventSource: (url: string) => KitchenBoardEventSource;
};

export function startKitchenBoardLiveLifecycle<T>(input: {
  stallSlug: string;
  environment: KitchenBoardLiveEnvironment;
  load: (signal: AbortSignal) => Promise<T>;
  onData: (value: T) => void;
  onError?: (error: unknown) => void;
  onConnectionChange: (state: KitchenBoardConnection) => void;
}): LiveResourceController {
  // This orders local requests only. SSE carries invalidations, not a server version.
  let sequence = 0;
  const resource = startLiveResource<T, number>({
    environment: input.environment,
    intervalMs: 12_000,
    load: async ({ signal }) => {
      const requestSequence = ++sequence;
      const value = await input.load(signal);
      return { value, cursor: requestSequence };
    },
    onData: (value, cursor) => {
      if (cursor === sequence) input.onData(value);
    },
    onError: input.onError,
    onOnlineChange: (online) => {
      if (!online) input.onConnectionChange("FALLBACK");
    },
    adapter: ({ signal, onEvent }) => {
      input.onConnectionChange("CONNECTING");
      if (!input.environment.supportsEventSource()) {
        input.onConnectionChange("FALLBACK");
        return;
      }
      const source = input.environment.createEventSource(`/api/stalls/${input.stallSlug}/kitchen/stream`);
      const invalidate = () => onEvent(++sequence);
      source.addEventListener("ready", () => {
        input.onConnectionChange("CONNECTED");
        invalidate(); // Close the gap between initial snapshot and live subscription.
      });
      source.addEventListener("kitchen", invalidate);
      source.onerror = () => input.onConnectionChange("FALLBACK");
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        source.close();
      };
      signal.addEventListener("abort", close, { once: true });
      return () => {
        signal.removeEventListener("abort", close);
        close();
      };
    },
  });
  return {
    refresh: () => {
      sequence += 1;
      return resource.refresh();
    },
    stop: resource.stop,
  };
}

export function browserKitchenBoardLiveEnvironment(): KitchenBoardLiveEnvironment {
  const subscribe = (target: Document | Window, type: string, listener: () => void) => {
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  };
  return {
    visibilityState: () => document.visibilityState,
    online: () => navigator.onLine,
    scheduleTimeout: (callback, ms) => window.setTimeout(callback, ms),
    cancelTimeout: (timer) => window.clearTimeout(timer),
    onVisibilityChange: (listener) => subscribe(document, "visibilitychange", listener),
    onOnline: (listener) => subscribe(window, "online", listener),
    onOffline: (listener) => subscribe(window, "offline", listener),
    supportsEventSource: () => "EventSource" in window,
    createEventSource: (url) => new EventSource(url),
  };
}
