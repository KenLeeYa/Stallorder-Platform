"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";

export type LiveResourceCursor = number | string;

export type LiveResourceEnvironment = {
  visibilityState: () => DocumentVisibilityState;
  online: () => boolean;
  scheduleTimeout: (callback: () => void, delayMs: number) => number;
  cancelTimeout: (timer: number) => void;
  onVisibilityChange: (listener: () => void) => () => void;
  onOnline: (listener: () => void) => () => void;
  onOffline: (listener: () => void) => () => void;
};

export type LiveResourceLoadContext<C extends LiveResourceCursor> = {
  signal: AbortSignal;
  cursor: C | undefined;
};

export type LiveResourceResult<T, C extends LiveResourceCursor> = {
  value: T;
  cursor?: C;
};

export type LiveResourceAdapter<C extends LiveResourceCursor> = (input: {
  cursor: C | undefined;
  signal: AbortSignal;
  onEvent: (cursor: C) => void;
  onError: (error: unknown) => void;
}) => void | (() => void);

export type LiveResourceOptions<T, C extends LiveResourceCursor> = {
  environment: LiveResourceEnvironment;
  load: (context: LiveResourceLoadContext<C>) => Promise<LiveResourceResult<T, C>>;
  onData: (value: T, cursor: C | undefined) => void;
  onError?: (error: unknown) => void;
  onLoadingChange?: (loading: boolean) => void;
  onOnlineChange?: (online: boolean) => void;
  adapter?: LiveResourceAdapter<C>;
  compareCursor?: (next: C, current: C) => number;
  intervalMs?: number;
  retryBaseMs?: number;
  maxBackoffMs?: number;
};

export type LiveResourceController = {
  refresh: () => Promise<void>;
  stop: () => void;
};

export function startLiveResource<T, C extends LiveResourceCursor = LiveResourceCursor>(
  options: LiveResourceOptions<T, C>,
): LiveResourceController {
  const intervalMs = options.intervalMs ?? 10_000;
  const retryBaseMs = options.retryBaseMs ?? 1_000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const compareCursor = options.compareCursor ?? defaultCompareCursor;
  let appliedCursor: C | undefined;
  let latestSeenCursor: C | undefined;
  let queuedCursor: C | undefined;
  let refreshTimer: number | null = null;
  let refreshAbort: AbortController | null = null;
  let adapterAbort: AbortController | null = null;
  let unsubscribeAdapter: (() => void) | null = null;
  let inFlight: Promise<void> | null = null;
  let queued = false;
  let active = false;
  let stopped = false;
  let failureCount = 0;

  const cancelRefreshTimer = () => {
    if (refreshTimer === null) return;
    options.environment.cancelTimeout(refreshTimer);
    refreshTimer = null;
  };

  const scheduleRefresh = (delayMs: number) => {
    cancelRefreshTimer();
    if (!active || stopped) return;
    refreshTimer = options.environment.scheduleTimeout(() => {
      refreshTimer = null;
      void requestRefresh();
    }, delayMs);
  };

  const stopAdapter = () => {
    adapterAbort?.abort();
    adapterAbort = null;
    unsubscribeAdapter?.();
    unsubscribeAdapter = null;
  };

  const rememberQueuedCursor = (next: C | undefined) => {
    if (next === undefined) return;
    if (
      queuedCursor === undefined
      || compareCursor(next, queuedCursor) > 0
    ) queuedCursor = next;
  };

  const acceptResult = (
    result: LiveResourceResult<T, C>,
    requestedCursor: C | undefined,
  ) => {
    const nextCursor = result.cursor ?? requestedCursor;
    if (nextCursor !== undefined) {
      if (
        latestSeenCursor !== undefined
        && compareCursor(nextCursor, latestSeenCursor) < 0
      ) return;
      if (
        appliedCursor !== undefined
        && compareCursor(nextCursor, appliedCursor) <= 0
      ) return;
      appliedCursor = nextCursor;
      if (
        latestSeenCursor === undefined
        || compareCursor(nextCursor, latestSeenCursor) > 0
      ) latestSeenCursor = nextCursor;
    }
    options.onData(result.value, nextCursor);
  };

  const performRefresh = async (requestedCursor: C | undefined) => {
    const abort = new AbortController();
    refreshAbort = abort;
    options.onLoadingChange?.(true);
    scheduleRefresh(intervalMs);
    try {
      const result = await options.load({
        signal: abort.signal,
        cursor: appliedCursor,
      });
      if (abort.signal.aborted || stopped || !active) return;
      failureCount = 0;
      acceptResult(result, requestedCursor);
    } catch (error) {
      if (abort.signal.aborted || stopped || !active) return;
      failureCount += 1;
      options.onError?.(error);
      scheduleRefresh(Math.min(
        retryBaseMs * 2 ** (failureCount - 1),
        maxBackoffMs,
      ));
    } finally {
      if (refreshAbort !== abort) return;
      refreshAbort = null;
      inFlight = null;
      if (stopped) return;
      if (queued && active) {
        const nextCursor = queuedCursor;
        queued = false;
        queuedCursor = undefined;
        if (
          nextCursor !== undefined
          && appliedCursor !== undefined
          && compareCursor(nextCursor, appliedCursor) <= 0
        ) {
          options.onLoadingChange?.(false);
          return;
        }
        cancelRefreshTimer();
        await requestRefresh(nextCursor);
        return;
      }
      options.onLoadingChange?.(false);
    }
  };

  const requestRefresh = (requestedCursor?: C) => {
    if (stopped || !active) return Promise.resolve();
    if (inFlight) {
      queued = true;
      rememberQueuedCursor(requestedCursor);
      return inFlight;
    }
    cancelRefreshTimer();
    inFlight = performRefresh(requestedCursor);
    return inFlight;
  };

  const startAdapter = () => {
    if (!options.adapter || adapterAbort || stopped || !active) return;
    const abort = new AbortController();
    adapterAbort = abort;
    try {
      const unsubscribe = options.adapter({
        cursor: appliedCursor,
        signal: abort.signal,
        onEvent: (nextCursor) => {
          if (stopped || !active) return;
          if (
            latestSeenCursor !== undefined
            && compareCursor(nextCursor, latestSeenCursor) <= 0
          ) return;
          latestSeenCursor = nextCursor;
          void requestRefresh(nextCursor);
        },
        onError: (error) => {
          if (stopped || !active) return;
          options.onError?.(error);
          void requestRefresh();
        },
      });
      if (typeof unsubscribe === "function") unsubscribeAdapter = unsubscribe;
    } catch (error) {
      options.onError?.(error);
    }
  };

  const deactivate = () => {
    if (!active) return;
    active = false;
    queued = false;
    queuedCursor = undefined;
    cancelRefreshTimer();
    refreshAbort?.abort();
    refreshAbort = null;
    inFlight = null;
    stopAdapter();
    options.onLoadingChange?.(false);
  };

  const synchronize = () => {
    if (stopped) return;
    const online = options.environment.online();
    options.onOnlineChange?.(online);
    const shouldBeActive = online
      && options.environment.visibilityState() === "visible";
    if (!shouldBeActive) {
      deactivate();
      return;
    }
    if (active) return;
    active = true;
    void requestRefresh();
    startAdapter();
  };

  const unsubscribeVisibility = options.environment.onVisibilityChange(synchronize);
  const unsubscribeOnline = options.environment.onOnline(synchronize);
  const unsubscribeOffline = options.environment.onOffline(synchronize);
  synchronize();

  return {
    refresh: () => requestRefresh(),
    stop: () => {
      if (stopped) return;
      stopped = true;
      active = false;
      queued = false;
      queuedCursor = undefined;
      cancelRefreshTimer();
      refreshAbort?.abort();
      stopAdapter();
      unsubscribeVisibility();
      unsubscribeOnline();
      unsubscribeOffline();
    },
  };
}

export type UseLiveResourceOptions<T, C extends LiveResourceCursor> = Omit<
  LiveResourceOptions<T, C>,
  "environment"
> & {
  resourceKey: number | string;
  enabled?: boolean;
  environment?: LiveResourceEnvironment;
};

export function useLiveResource<T, C extends LiveResourceCursor = LiveResourceCursor>(
  options: UseLiveResourceOptions<T, C>,
) {
  const controllerRef = useRef<LiveResourceController | null>(null);
  const load = useEffectEvent((context: LiveResourceLoadContext<C>) => options.load(context));
  const onData = useEffectEvent((value: T, cursor: C | undefined) => {
    options.onData(value, cursor);
  });
  const onError = useEffectEvent((error: unknown) => options.onError?.(error));
  const onLoadingChange = useEffectEvent((loading: boolean) => {
    options.onLoadingChange?.(loading);
  });
  const onOnlineChange = useEffectEvent((online: boolean) => {
    options.onOnlineChange?.(online);
  });

  useEffect(() => {
    if (options.enabled === false) {
      controllerRef.current = null;
      return;
    }
    const controller = startLiveResource<T, C>({
      environment: options.environment ?? createBrowserEnvironment(),
      load,
      onData,
      onError,
      onLoadingChange,
      onOnlineChange,
      adapter: options.adapter,
      compareCursor: options.compareCursor,
      intervalMs: options.intervalMs,
      retryBaseMs: options.retryBaseMs,
      maxBackoffMs: options.maxBackoffMs,
    });
    controllerRef.current = controller;
    return () => {
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [
    options.adapter,
    options.compareCursor,
    options.enabled,
    options.environment,
    options.intervalMs,
    options.maxBackoffMs,
    options.resourceKey,
    options.retryBaseMs,
  ]);

  const refresh = useCallback(
    () => controllerRef.current?.refresh() ?? Promise.resolve(),
    [],
  );
  return { refresh };
}

function createBrowserEnvironment(): LiveResourceEnvironment {
  return {
    visibilityState: () => document.visibilityState,
    online: () => navigator.onLine,
    scheduleTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancelTimeout: (timer) => window.clearTimeout(timer),
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

function defaultCompareCursor(next: LiveResourceCursor, current: LiveResourceCursor) {
  if (typeof next === "number" && typeof current === "number") return next - current;
  const nextValue = String(next);
  const currentValue = String(current);
  if (/^\d+$/.test(nextValue) && /^\d+$/.test(currentValue)) {
    const normalizedNext = nextValue.replace(/^0+(?=\d)/, "");
    const normalizedCurrent = currentValue.replace(/^0+(?=\d)/, "");
    if (normalizedNext.length !== normalizedCurrent.length) {
      return normalizedNext.length - normalizedCurrent.length;
    }
    if (normalizedNext === normalizedCurrent) return 0;
    return normalizedNext > normalizedCurrent ? 1 : -1;
  }
  if (nextValue === currentValue) return 0;
  return nextValue > currentValue ? 1 : -1;
}
