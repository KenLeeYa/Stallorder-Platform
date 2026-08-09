import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sessionCountdownPhase,
  sessionSecondsRemaining,
  startVisibilityAwareSessionCountdown,
} from "@/lib/session-countdown";

describe("session countdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rounds partial seconds up without returning a negative value", () => {
    expect(sessionSecondsRemaining("1970-01-01T00:01:00.001Z", 0)).toBe(61);
    expect(sessionSecondsRemaining("1970-01-01T00:01:00.000Z", 0)).toBe(60);
    expect(sessionSecondsRemaining("1970-01-01T00:00:00.000Z", 1)).toBe(0);
    expect(sessionSecondsRemaining("invalid", 0)).toBe(0);
  });

  it("changes phase only at the 60 second and expiry boundaries", () => {
    expect(sessionCountdownPhase(null, 0)).toBe("INACTIVE");
    expect(sessionCountdownPhase("1970-01-01T00:01:00.001Z", 0)).toBe("ACTIVE");
    expect(sessionCountdownPhase("1970-01-01T00:01:00.000Z", 0)).toBe("EXPIRING");
    expect(sessionCountdownPhase("1970-01-01T00:00:00.000Z", 0)).toBe("EXPIRED");
  });

  it("pauses while hidden, resumes with one interval, and removes its listener on cleanup", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visibility: DocumentVisibilityState = "hidden";
    const visibilityListeners = new Set<() => void>();
    const snapshots: Array<{ seconds: number; phase: string }> = [];
    const scheduleInterval = vi.fn((callback: () => void, intervalMs: number) => (
      setInterval(callback, intervalMs) as unknown as number
    ));
    const cancelInterval = vi.fn((timer: number) => clearInterval(timer));

    const stop = startVisibilityAwareSessionCountdown({
      active: true,
      expiresAt: "1970-01-01T00:02:00.000Z",
      environment: {
        now: () => Date.now(),
        visibilityState: () => visibility,
        scheduleInterval,
        cancelInterval,
        onVisibilityChange: (listener) => {
          visibilityListeners.add(listener);
          return () => visibilityListeners.delete(listener);
        },
      },
      onTick: (snapshot) => snapshots.push(snapshot),
    });

    expect(snapshots).toHaveLength(0);
    expect(scheduleInterval).not.toHaveBeenCalled();

    visibility = "visible";
    visibilityListeners.forEach((listener) => listener());
    visibilityListeners.forEach((listener) => listener());
    expect(snapshots.at(-1)).toEqual({ seconds: 120, phase: "ACTIVE" });
    expect(scheduleInterval).toHaveBeenCalledTimes(1);

    visibility = "hidden";
    visibilityListeners.forEach((listener) => listener());
    expect(cancelInterval).toHaveBeenCalledTimes(1);
    const snapshotCount = snapshots.length;
    vi.advanceTimersByTime(5_000);
    expect(snapshots).toHaveLength(snapshotCount);

    stop();
    expect(visibilityListeners.size).toBe(0);
  });

  it("stops the interval at expiry and does not tick again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const snapshots: Array<{ seconds: number; phase: string }> = [];
    const cancelInterval = vi.fn((timer: number) => clearInterval(timer));

    const stop = startVisibilityAwareSessionCountdown({
      active: true,
      expiresAt: "1970-01-01T00:01:01.000Z",
      environment: {
        now: () => Date.now(),
        visibilityState: () => "visible",
        scheduleInterval: (callback, intervalMs) => (
          setInterval(callback, intervalMs) as unknown as number
        ),
        cancelInterval,
        onVisibilityChange: () => () => undefined,
      },
      onTick: (snapshot) => snapshots.push(snapshot),
    });

    expect(snapshots.at(-1)).toEqual({ seconds: 61, phase: "ACTIVE" });
    vi.advanceTimersByTime(1_000);
    expect(snapshots.at(-1)).toEqual({ seconds: 60, phase: "EXPIRING" });
    vi.advanceTimersByTime(60_000);
    expect(snapshots.at(-1)).toEqual({ seconds: 0, phase: "EXPIRED" });
    expect(cancelInterval).toHaveBeenCalledTimes(1);

    const snapshotCount = snapshots.length;
    vi.advanceTimersByTime(5_000);
    expect(snapshots).toHaveLength(snapshotCount);
    stop();
    expect(cancelInterval).toHaveBeenCalledTimes(1);
  });
});
