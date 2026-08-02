import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QR_CAPACITY_REFRESH_INTERVAL_MS,
  shouldRefreshQrCapacity,
} from "./qr-capacity-refresh";

const base = {
  orderingMode: "DEFAULT" as const,
  sessionReady: true,
  secondsRemaining: 120,
  visibilityState: "visible" as const,
  sessionRequestId: "11111111-1111-4111-8111-111111111111",
  lastRefreshAt: 1_000,
  now: 1_000 + QR_CAPACITY_REFRESH_INTERVAL_MS,
};

describe("QR capacity refresh gate", () => {
  afterEach(() => vi.useRealTimers());
  it("allows one visible live-order refresh after the low-frequency interval", () => {
    expect(shouldRefreshQrCapacity(base)).toBe(true);
    expect(shouldRefreshQrCapacity({ ...base, orderingMode: "DELIVERY" })).toBe(true);
  });

  it("does not poll too early, in the background, before session readiness, or without replay identity", () => {
    expect(shouldRefreshQrCapacity({ ...base, now: base.now - 1 })).toBe(false);
    expect(shouldRefreshQrCapacity({ ...base, visibilityState: "hidden" })).toBe(false);
    expect(shouldRefreshQrCapacity({ ...base, sessionReady: false })).toBe(false);
    expect(shouldRefreshQrCapacity({ ...base, secondsRemaining: 0 })).toBe(false);
    expect(shouldRefreshQrCapacity({ ...base, sessionRequestId: null })).toBe(false);
  });

  it("never polls PREORDER capacity", () => {
    expect(shouldRefreshQrCapacity({ ...base, orderingMode: "PREORDER" })).toBe(false);
  });

  it("fake-timer contract emits at most once per minute and skips hidden or PREORDER ticks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let lastRefreshAt = 0;
    let visibilityState: DocumentVisibilityState = "visible";
    let orderingMode: "DEFAULT" | "PREORDER" = "DEFAULT";
    let calls = 0;
    const timer = setInterval(() => {
      const now = Date.now();
      if (shouldRefreshQrCapacity({
        ...base,
        orderingMode,
        visibilityState,
        lastRefreshAt,
        now,
      })) {
        calls += 1;
        lastRefreshAt = now;
      }
    }, 15_000);

    vi.advanceTimersByTime(59_999);
    expect(calls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(calls).toBe(1);
    visibilityState = "hidden";
    vi.advanceTimersByTime(60_000);
    expect(calls).toBe(1);
    visibilityState = "visible";
    orderingMode = "PREORDER";
    vi.advanceTimersByTime(60_000);
    expect(calls).toBe(1);
    clearInterval(timer);
  });
});
