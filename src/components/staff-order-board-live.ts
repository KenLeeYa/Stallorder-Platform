import {
  startLiveResource,
  type LiveResourceController,
  type LiveResourceEnvironment,
} from "@/lib/use-live-resource";

export type StaffOrderLiveConnectionState = "connecting" | "sse" | "realtime" | "polling";

type StaffOrderRealtimeStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED";

export type StaffOrderRealtimeSubscriptionInput = {
  stallId: string;
  onOrdersChanged: () => void;
  onStatus: (status: StaffOrderRealtimeStatus) => void;
};

export type StaffOrderLiveEventSource = {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener: (type: "orders", listener: (event: Event) => void) => void;
  close: () => void;
};

export type StaffOrderLiveEnvironment = LiveResourceEnvironment & {
  supportsEventSource: () => boolean;
  createEventSource: (url: string) => StaffOrderLiveEventSource;
  connectRealtime: (
    input: StaffOrderRealtimeSubscriptionInput,
  ) => Promise<(() => void) | null>;
  scheduleInterval: (callback: () => void, intervalMs: number) => number;
  cancelInterval: (timer: number) => void;
};

export function startStaffOrderLiveLifecycle<T>(input: {
  stallId: string;
  stallSlug: string;
  environment: StaffOrderLiveEnvironment;
  load: (signal: AbortSignal) => Promise<T>;
  onData: (value: T) => void;
  onError?: (error: unknown) => void;
  refreshBackendAvailability: () => void;
  onConnectionChange: (state: StaffOrderLiveConnectionState) => void;
}): LiveResourceController {
  const adapter = createStaffOrderLiveAdapter(input);
  return startLiveResource<T, number>({
    environment: input.environment,
    intervalMs: 30_000,
    adapter,
    load: async ({ signal }) => ({ value: await input.load(signal) }),
    onData: input.onData,
    onError: input.onError,
    onOnlineChange: (online) => {
      if (!online) input.onConnectionChange("connecting");
    },
  });
}

function createStaffOrderLiveAdapter(input: {
  stallId: string;
  stallSlug: string;
  environment: StaffOrderLiveEnvironment;
  refreshBackendAvailability: () => void;
  onConnectionChange: (state: StaffOrderLiveConnectionState) => void;
}) {
  let sequence = 0;

  return ({
    cursor,
    signal,
    onEvent,
  }: {
    cursor: number | undefined;
    signal: AbortSignal;
    onEvent: (cursor: number) => void;
  }) => {
    sequence = Math.max(sequence, cursor ?? 0);
    let eventSource: StaffOrderLiveEventSource | null = null;
    let realtimeConnected = false;
    let sseConnected = false;
    let realtimeLoadStarted = false;
    let realtimeAttempt = 0;
    let removeRealtimeChannel: (() => void) | null = null;
    let fallbackTimer: number | null = null;
    let fallbackStatusTimer: number | null = null;
    let disposed = false;

    const emitRefresh = () => {
      if (!disposed) onEvent(++sequence);
    };
    const stopFallback = () => {
      if (fallbackTimer !== null) {
        input.environment.cancelInterval(fallbackTimer);
        fallbackTimer = null;
      }
      if (fallbackStatusTimer !== null) {
        input.environment.cancelTimeout(fallbackStatusTimer);
        fallbackStatusTimer = null;
      }
    };
    const startFallback = (refreshImmediately: boolean) => {
      if (fallbackTimer === null) {
        if (refreshImmediately) emitRefresh();
        fallbackTimer = input.environment.scheduleInterval(emitRefresh, 5_000);
      }
      if (fallbackStatusTimer === null) {
        fallbackStatusTimer = input.environment.scheduleTimeout(() => {
          if (!realtimeConnected && !sseConnected) input.onConnectionChange("polling");
          fallbackStatusTimer = null;
        }, 4_000);
      }
    };
    const stopRealtime = () => {
      realtimeAttempt += 1;
      removeRealtimeChannel?.();
      removeRealtimeChannel = null;
      realtimeConnected = false;
      realtimeLoadStarted = false;
    };
    const startRealtimeFallback = async () => {
      if (disposed || sseConnected || realtimeLoadStarted) return;
      realtimeLoadStarted = true;
      const attempt = ++realtimeAttempt;
      try {
        const remove = await input.environment.connectRealtime({
          stallId: input.stallId,
          onOrdersChanged: () => {
            if (disposed || attempt !== realtimeAttempt || sseConnected) return;
            emitRefresh();
          },
          onStatus: (status) => {
            if (disposed || attempt !== realtimeAttempt || sseConnected) return;
            if (status === "SUBSCRIBED") {
              realtimeConnected = true;
              stopFallback();
              input.onConnectionChange("realtime");
              input.refreshBackendAvailability();
              emitRefresh();
            }
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              realtimeConnected = false;
              if (!sseConnected) startFallback(true);
            }
          },
        });
        if (disposed || attempt !== realtimeAttempt || sseConnected) {
          remove?.();
          return;
        }
        removeRealtimeChannel = remove;
      } catch {
        if (attempt !== realtimeAttempt) return;
        realtimeLoadStarted = false;
        if (!sseConnected) startFallback(false);
      }
    };
    const stop = () => {
      if (disposed) return;
      disposed = true;
      eventSource?.close();
      stopRealtime();
      stopFallback();
      signal.removeEventListener("abort", stop);
    };

    input.onConnectionChange("connecting");
    if (input.environment.supportsEventSource()) {
      eventSource = input.environment.createEventSource(
        `/api/stalls/${input.stallSlug}/orders/stream`,
      );
      eventSource.onopen = () => {
        if (disposed) return;
        sseConnected = true;
        stopRealtime();
        stopFallback();
        input.onConnectionChange("sse");
        input.refreshBackendAvailability();
        emitRefresh();
      };
      eventSource.addEventListener("orders", emitRefresh);
      eventSource.onerror = () => {
        if (disposed) return;
        sseConnected = false;
        if (!realtimeConnected) {
          void startRealtimeFallback();
          startFallback(true);
        }
      };
    } else {
      void startRealtimeFallback();
      startFallback(false);
    }

    signal.addEventListener("abort", stop, { once: true });
    return stop;
  };
}

export function browserStaffOrderLiveEnvironment(): StaffOrderLiveEnvironment {
  return {
    supportsEventSource: () => "EventSource" in window,
    createEventSource: (url) => new EventSource(url),
    connectRealtime: async (input) => {
      const { createOptionalSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const supabase = createOptionalSupabaseBrowserClient();
      if (!supabase) return null;
      const channel = supabase
        .channel(`stall:${input.stallId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "operational_events",
            filter: `stall_id=eq.${input.stallId}`,
          },
          input.onOrdersChanged,
        )
        .subscribe(input.onStatus);
      return () => void supabase.removeChannel(channel);
    },
    scheduleInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
    cancelInterval: (timer) => window.clearInterval(timer),
    scheduleTimeout: (callback, timeoutMs) => window.setTimeout(callback, timeoutMs),
    cancelTimeout: (timer) => window.clearTimeout(timer),
    visibilityState: () => document.visibilityState,
    online: () => navigator.onLine,
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    onOnline: (listener) => {
      window.addEventListener("online", listener);
      return () => window.removeEventListener("online", listener);
    },
    onOffline: (listener) => {
      window.addEventListener("offline", listener);
      return () => window.removeEventListener("offline", listener);
    },
  };
}
