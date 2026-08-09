export type SessionCountdownPhase = "INACTIVE" | "ACTIVE" | "EXPIRING" | "EXPIRED";

export type SessionCountdownSnapshot = {
  seconds: number;
  phase: SessionCountdownPhase;
};

export type SessionCountdownEnvironment = {
  now: () => number;
  visibilityState: () => DocumentVisibilityState;
  scheduleInterval: (callback: () => void, intervalMs: number) => number;
  cancelInterval: (timer: number) => void;
  onVisibilityChange: (listener: () => void) => () => void;
};

export function sessionSecondsRemaining(expiresAt: string | null | undefined, now = Date.now()) {
  if (!expiresAt) return 0;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return 0;
  return Math.max(0, Math.ceil((expiry - now) / 1_000));
}

export function sessionCountdownPhase(
  expiresAt: string | null | undefined,
  now = Date.now(),
): SessionCountdownPhase {
  if (!expiresAt) return "INACTIVE";
  const seconds = sessionSecondsRemaining(expiresAt, now);
  if (seconds <= 0) return "EXPIRED";
  return seconds <= 60 ? "EXPIRING" : "ACTIVE";
}

export function startVisibilityAwareSessionCountdown(input: {
  active: boolean;
  expiresAt: string | null | undefined;
  environment: SessionCountdownEnvironment;
  onTick: (snapshot: SessionCountdownSnapshot) => void;
  intervalMs?: number;
}) {
  let timer: number | null = null;

  const stopTimer = () => {
    if (timer === null) return;
    input.environment.cancelInterval(timer);
    timer = null;
  };
  const update = () => {
    const now = input.environment.now();
    const seconds = input.active
      ? sessionSecondsRemaining(input.expiresAt, now)
      : 0;
    const phase = input.active
      ? sessionCountdownPhase(input.expiresAt, now)
      : "INACTIVE";
    input.onTick({ seconds, phase });
    if (phase === "EXPIRED") stopTimer();
    return phase;
  };
  const synchronize = () => {
    if (input.environment.visibilityState() !== "visible") {
      stopTimer();
      return;
    }
    const phase = update();
    if (input.active && phase !== "EXPIRED" && timer === null) {
      timer = input.environment.scheduleInterval(update, input.intervalMs ?? 1_000);
    }
  };

  if (input.active) synchronize();
  else update();
  const unsubscribeVisibility = input.environment.onVisibilityChange(synchronize);

  return () => {
    stopTimer();
    unsubscribeVisibility();
  };
}
