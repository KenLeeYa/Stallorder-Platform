import { describe, expect, it, vi } from "vitest";
import type { PublicAvailabilityConfig } from "@/lib/public-order-client";
import {
  startQrOrderAvailabilityLifecycle,
  type QrOrderAvailabilityEnvironment,
} from "./qr-order-availability-controller";

const availableConfig: PublicAvailabilityConfig = {
  mode: "NORMAL_PRIMARY",
  activeBackend: "PRIMARY",
  promotionEpoch: 1,
  orderIntake: "EDGE_PRIMARY",
  qrOrdering: "AVAILABLE",
  staffOnline: "AVAILABLE",
  offlinePos: "AVAILABLE",
  linePay: "UNKNOWN",
  jkoPay: "UNKNOWN",
  updatedAt: null,
};

describe("QR order availability controller", () => {
  it("owns polling and restarts a session only for recovery, retry, or target changes", async () => {
    const fixture = availabilityEnvironment();
    let status: "DEGRADED" | "AVAILABLE" = "DEGRADED";
    const loadAvailability = vi.fn().mockResolvedValue(availableConfig);
    const onOrderingAvailable = vi.fn();
    const lifecycle = startQrOrderAvailabilityLifecycle({
      deviceId: "device-id",
      sessionReady: () => true,
      currentStatus: () => status,
      loadAvailability,
      environment: fixture.environment,
      onRefreshingChange: vi.fn(),
      onMissingAvailability: vi.fn(),
      onOrderingDisabled: vi.fn(),
      onOrderingAvailable,
    });

    await flushMicrotasks();
    expect(loadAvailability).toHaveBeenCalledWith("device-id", { forceRefresh: false });
    expect(onOrderingAvailable).toHaveBeenLastCalledWith({
      targetChanged: false,
      shouldStartSession: true,
    });
    expect(fixture.scheduleInterval).toHaveBeenCalledWith(expect.any(Function), 10_000);

    status = "AVAILABLE";
    await lifecycle.refresh(false, true);
    expect(onOrderingAvailable).toHaveBeenLastCalledWith({
      targetChanged: false,
      shouldStartSession: false,
    });

    loadAvailability.mockResolvedValue({
      ...availableConfig,
      activeBackend: "DR",
      promotionEpoch: 2,
    });
    await lifecycle.refresh(false, true);
    expect(onOrderingAvailable).toHaveBeenLastCalledWith({
      targetChanged: true,
      shouldStartSession: true,
    });

    lifecycle.stop();
    expect(fixture.cancelInterval).toHaveBeenCalledWith(1);
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable states and pauses polling while the document is hidden", async () => {
    const fixture = availabilityEnvironment();
    const loadAvailability = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...availableConfig, qrOrdering: "MAINTENANCE" })
      .mockResolvedValue(availableConfig);
    const onMissingAvailability = vi.fn();
    const onOrderingDisabled = vi.fn();
    const lifecycle = startQrOrderAvailabilityLifecycle({
      deviceId: "device-id",
      sessionReady: () => false,
      currentStatus: () => "UNAVAILABLE",
      loadAvailability,
      environment: fixture.environment,
      onRefreshingChange: vi.fn(),
      onMissingAvailability,
      onOrderingDisabled,
      onOrderingAvailable: vi.fn(),
    });

    await flushMicrotasks();
    expect(onMissingAvailability).toHaveBeenCalledTimes(1);
    await lifecycle.refresh();
    expect(onOrderingDisabled).toHaveBeenCalledWith("MAINTENANCE");

    fixture.setVisibility("hidden");
    expect(fixture.cancelInterval).toHaveBeenCalledWith(1);
    fixture.setVisibility("visible");
    await flushMicrotasks();
    expect(loadAvailability).toHaveBeenLastCalledWith("device-id", { forceRefresh: true });

    lifecycle.stop();
  });
});

function availabilityEnvironment() {
  let visibility: DocumentVisibilityState = "visible";
  let visibilityListener: (() => void) | null = null;
  const scheduleInterval = vi.fn(() => 1);
  const cancelInterval = vi.fn();
  const unsubscribe = vi.fn();
  return {
    scheduleInterval,
    cancelInterval,
    unsubscribe,
    setVisibility(next: DocumentVisibilityState) {
      visibility = next;
      visibilityListener?.();
    },
    environment: {
      visibilityState: () => visibility,
      scheduleInterval,
      cancelInterval,
      subscribeVisibility: (listener) => {
        visibilityListener = listener;
        return unsubscribe;
      },
    } satisfies QrOrderAvailabilityEnvironment,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
