"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  sessionCountdownPhase,
  sessionSecondsRemaining,
  startVisibilityAwareSessionCountdown,
  type SessionCountdownPhase,
} from "@/lib/session-countdown";

type Props = {
  active: boolean;
  expiresAt: string | null | undefined;
  availabilityStatus: string;
  activeLabel: (minutes: number, paddedSeconds: string) => string;
  inactiveLabel: string;
  onPhaseChange: (phase: SessionCountdownPhase) => void;
};

type Snapshot = {
  active: boolean;
  expiresAt: string | null | undefined;
  seconds: number;
};

export function QrSessionCountdown({
  active,
  expiresAt,
  availabilityStatus,
  activeLabel,
  inactiveLabel,
  onPhaseChange,
}: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    active,
    expiresAt,
    seconds: active ? sessionSecondsRemaining(expiresAt) : 0,
  }));
  const phaseRef = useRef<SessionCountdownPhase>(
    active ? sessionCountdownPhase(expiresAt) : "INACTIVE",
  );
  const onPhaseChangeRef = useRef(onPhaseChange);

  useEffect(() => {
    onPhaseChangeRef.current = onPhaseChange;
  }, [onPhaseChange]);

  const seconds = snapshot.active === active && snapshot.expiresAt === expiresAt
    ? snapshot.seconds
    : active ? sessionSecondsRemaining(expiresAt) : 0;

  useEffect(() => {
    return startVisibilityAwareSessionCountdown({
      active,
      expiresAt,
      environment: {
        now: () => Date.now(),
        visibilityState: () => document.visibilityState,
        scheduleInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
        cancelInterval: (timer) => window.clearInterval(timer),
        onVisibilityChange: (listener) => {
          document.addEventListener("visibilitychange", listener);
          return () => document.removeEventListener("visibilitychange", listener);
        },
      },
      onTick: ({ seconds: nextSeconds, phase: nextPhase }) => {
        setSnapshot({ active, expiresAt, seconds: nextSeconds });
        if (phaseRef.current !== nextPhase) {
          phaseRef.current = nextPhase;
          onPhaseChangeRef.current(nextPhase);
        }
      },
    });
  }, [active, expiresAt]);

  return (
    <div
      data-testid="qr-session-status"
      data-ordering-availability={availabilityStatus}
      className="mt-3 inline-flex items-center gap-2 text-sm text-stone-600"
    >
      <Clock3 className="h-4 w-4" />
      {active
        ? activeLabel(Math.floor(seconds / 60), String(seconds % 60).padStart(2, "0"))
        : inactiveLabel}
    </div>
  );
}
