import {
  getPublicAvailability,
  type PublicAvailabilityConfig,
  type PublicAvailabilityStatus,
} from "@/lib/public-order-client";

type AvailabilityStatus = PublicAvailabilityStatus | "CHECKING";

export type QrOrderAvailabilityEnvironment = {
  visibilityState: () => DocumentVisibilityState;
  scheduleInterval: (callback: () => void, intervalMs: number) => number;
  cancelInterval: (timer: number) => void;
  subscribeVisibility: (callback: () => void) => () => void;
};

export type QrOrderAvailabilityLifecycle = {
  refresh: (retrySession?: boolean, forceRefresh?: boolean) => Promise<void>;
  stop: () => void;
};

type QrOrderAvailabilityInput = {
  deviceId: string;
  sessionReady: () => boolean;
  currentStatus: () => AvailabilityStatus;
  loadAvailability?: (
    deviceId: string,
    options: { forceRefresh: boolean },
  ) => Promise<PublicAvailabilityConfig | null>;
  environment?: QrOrderAvailabilityEnvironment;
  onRefreshingChange: (refreshing: boolean) => void;
  onMissingAvailability: () => void;
  onOrderingDisabled: (status: PublicAvailabilityStatus) => void;
  onOrderingAvailable: (input: {
    targetChanged: boolean;
    shouldStartSession: boolean;
  }) => Promise<void> | void;
};

const AVAILABILITY_POLL_INTERVAL_MS = 10_000;

export function startQrOrderAvailabilityLifecycle(
  input: QrOrderAvailabilityInput,
): QrOrderAvailabilityLifecycle {
  const environment = input.environment ?? browserAvailabilityEnvironment();
  const loadAvailability = input.loadAvailability ?? getPublicAvailability;
  let activeTarget: string | null = null;
  let timer: number | null = null;
  let disposed = false;

  const refresh = async (
    retrySession = false,
    forceRefresh = true,
  ) => {
    if (disposed) return;
    input.onRefreshingChange(true);
    const config = await loadAvailability(input.deviceId, { forceRefresh });
    if (disposed) return;
    input.onRefreshingChange(false);
    if (!config) {
      if (!input.sessionReady()) input.onMissingAvailability();
      return;
    }

    const target = `${config.activeBackend}:${config.promotionEpoch}`;
    const targetChanged = activeTarget !== null && activeTarget !== target;
    activeTarget = target;

    if (config.qrOrdering !== "AVAILABLE") {
      input.onOrderingDisabled(config.qrOrdering);
      return;
    }

    const currentStatus = input.currentStatus();
    await input.onOrderingAvailable({
      targetChanged,
      shouldStartSession: retrySession
        || targetChanged
        || currentStatus === "DEGRADED"
        || currentStatus === "UNAVAILABLE"
        || currentStatus === "MAINTENANCE",
    });
  };

  const startTimer = () => {
    if (timer === null) {
      timer = environment.scheduleInterval(
        () => void refresh(false, true),
        AVAILABILITY_POLL_INTERVAL_MS,
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
      void refresh(false, true);
      startTimer();
    } else {
      stopTimer();
    }
  };

  void refresh(false, false);
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

function browserAvailabilityEnvironment(): QrOrderAvailabilityEnvironment {
  return {
    visibilityState: () => document.visibilityState,
    scheduleInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
    cancelInterval: (timer) => window.clearInterval(timer),
    subscribeVisibility: (callback) => {
      document.addEventListener("visibilitychange", callback);
      return () => document.removeEventListener("visibilitychange", callback);
    },
  };
}
