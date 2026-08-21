import {
  createPublicOrderOperationId,
  parseEdgeResponse,
  requestPublicOrder,
} from "@/lib/public-order-client";
import { shouldRotateSessionRequestId } from "@/lib/public-order-session-retry";
import { shouldRefreshQrCapacity } from "@/lib/qr-capacity-refresh";
import { sessionSecondsRemaining } from "@/lib/session-countdown";

export type QrOrderCapacityEnvironment = {
  now: () => number;
  visibilityState: () => DocumentVisibilityState;
  scheduleInterval: (callback: () => void, intervalMs: number) => number;
  cancelInterval: (timer: number) => void;
  subscribeVisibility: (callback: () => void) => () => void;
};

export type QrOrderCapacityTransport = (
  input: Record<string, unknown>,
  operationId: string,
) => Promise<{
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}>;

export type QrOrderCapacityQuote = {
  estimatedWaitMinMinutes: number;
  estimatedWaitMaxMinutes: number;
  waitAcknowledgmentThresholdMinutes: number | null;
  requiresWaitAcknowledgment: boolean;
  resetWaitAcknowledgment: boolean;
};

export type QrOrderCapacityLifecycle = {
  refresh: () => Promise<void>;
  stop: () => void;
};

type QrOrderCapacityInput = {
  qrToken: string;
  deviceId: string;
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER";
  orderSessionToken: string;
  expiresAt: string;
  currentQuote: {
    estimatedWaitMinMinutes: number;
    estimatedWaitMaxMinutes: number;
    requiresWaitAcknowledgment: boolean;
  };
  sessionReady: () => boolean;
  sessionRequestId: () => string | null;
  requestSession?: QrOrderCapacityTransport;
  createOperationId?: () => string;
  environment?: QrOrderCapacityEnvironment;
  onQuote: (quote: QrOrderCapacityQuote) => void;
};

const CAPACITY_POLL_INTERVAL_MS = 15_000;

const defaultRequestSession: QrOrderCapacityTransport = async (input, operationId) => {
  const response = await requestPublicOrder(
    "create-order-session",
    input,
    { operationId },
  );
  return {
    ok: response.ok,
    status: response.status,
    payload: await parseEdgeResponse(response),
  };
};

export function startQrOrderCapacityLifecycle(
  input: QrOrderCapacityInput,
): QrOrderCapacityLifecycle {
  const environment = input.environment ?? browserCapacityEnvironment();
  const requestSession = input.requestSession ?? defaultRequestSession;
  const createOperationId = input.createOperationId ?? createPublicOrderOperationId;
  let lastRefreshAt = environment.now();
  let currentQuote = input.currentQuote;
  let operationId: string | null = null;
  let refreshInFlight = false;
  let refreshStopped = false;
  let disposed = false;
  let timer: number | null = null;

  const refresh = async () => {
    const now = environment.now();
    const sessionRequestId = input.sessionRequestId();
    if (
      disposed
      || refreshStopped
      || refreshInFlight
      || !shouldRefreshQrCapacity({
        orderingMode: input.orderingMode,
        sessionReady: input.sessionReady(),
        secondsRemaining: sessionSecondsRemaining(input.expiresAt, now),
        visibilityState: environment.visibilityState(),
        sessionRequestId,
        lastRefreshAt,
        now,
      })
    ) return;

    lastRefreshAt = now;
    refreshInFlight = true;
    if (!operationId) operationId = createOperationId();
    try {
      const response = await requestSession({
        qrToken: input.qrToken,
        deviceId: input.deviceId,
        sessionRequestId,
        orderingMode: input.orderingMode,
        includeMenu: false,
      }, operationId);
      if (disposed) return;
      if (!response.ok) {
        if (shouldRotateSessionRequestId(
          response.status,
          String(response.payload.code ?? ""),
        )) {
          refreshStopped = true;
          operationId = null;
        }
        return;
      }

      operationId = null;
      if (response.payload.orderSessionToken !== input.orderSessionToken) return;
      const estimatedWaitMinMinutes = Number(response.payload.estimatedWaitMinMinutes);
      const estimatedWaitMaxMinutes = Number(response.payload.estimatedWaitMaxMinutes);
      const waitAcknowledgmentThresholdMinutes =
        response.payload.waitAcknowledgmentThresholdMinutes === null
          ? null
          : Number(response.payload.waitAcknowledgmentThresholdMinutes);
      const requiresWaitAcknowledgment = response.payload.requiresWaitAcknowledgment === true;
      const resetWaitAcknowledgment = requiresWaitAcknowledgment
        && (
          currentQuote.estimatedWaitMinMinutes !== estimatedWaitMinMinutes
          || currentQuote.estimatedWaitMaxMinutes !== estimatedWaitMaxMinutes
          || !currentQuote.requiresWaitAcknowledgment
        );
      currentQuote = {
        estimatedWaitMinMinutes,
        estimatedWaitMaxMinutes,
        requiresWaitAcknowledgment,
      };
      input.onQuote({
        estimatedWaitMinMinutes,
        estimatedWaitMaxMinutes,
        waitAcknowledgmentThresholdMinutes,
        requiresWaitAcknowledgment,
        resetWaitAcknowledgment,
      });
    } catch {
      // A background quote refresh must never interrupt an active cart.
    } finally {
      refreshInFlight = false;
    }
  };

  const startTimer = () => {
    if (timer === null) {
      timer = environment.scheduleInterval(
        () => void refresh(),
        CAPACITY_POLL_INTERVAL_MS,
      );
    }
  };
  const stopTimer = () => {
    if (timer === null) return;
    environment.cancelInterval(timer);
    timer = null;
  };
  const handleVisibilityChange = () => {
    if (environment.visibilityState() === "visible") {
      void refresh();
      startTimer();
    } else {
      stopTimer();
    }
  };

  if (environment.visibilityState() === "visible") startTimer();
  const unsubscribeVisibility = environment.subscribeVisibility(handleVisibilityChange);

  return {
    refresh,
    stop() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      unsubscribeVisibility();
    },
  };
}

function browserCapacityEnvironment(): QrOrderCapacityEnvironment {
  return {
    now: () => Date.now(),
    visibilityState: () => document.visibilityState,
    scheduleInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
    cancelInterval: (timer) => window.clearInterval(timer),
    subscribeVisibility: (callback) => {
      document.addEventListener("visibilitychange", callback);
      return () => document.removeEventListener("visibilitychange", callback);
    },
  };
}
