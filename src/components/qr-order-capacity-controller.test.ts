import { describe, expect, it, vi } from "vitest";
import {
  startQrOrderCapacityLifecycle,
  type QrOrderCapacityEnvironment,
  type QrOrderCapacityTransport,
} from "./qr-order-capacity-controller";

const startedAt = Date.parse("2026-08-13T00:00:00.000Z");
const expiresAt = "2026-08-13T00:15:00.000Z";

describe("QR order capacity controller", () => {
  it("refreshes only when due and emits wait-acknowledgment changes", async () => {
    const fixture = capacityEnvironment();
    const requestSession = vi.fn<QrOrderCapacityTransport>().mockResolvedValue({
      ok: true,
      status: 200,
      payload: {
        orderSessionToken: "session-token",
        estimatedWaitMinMinutes: 18,
        estimatedWaitMaxMinutes: 24,
        waitAcknowledgmentThresholdMinutes: 20,
        requiresWaitAcknowledgment: true,
      },
    });
    const onQuote = vi.fn();
    const lifecycle = startQrOrderCapacityLifecycle({
      qrToken: "qr-token",
      deviceId: "device-id",
      orderingMode: "DEFAULT",
      orderSessionToken: "session-token",
      expiresAt,
      currentQuote: {
        estimatedWaitMinMinutes: 5,
        estimatedWaitMaxMinutes: 10,
        requiresWaitAcknowledgment: false,
      },
      sessionReady: () => true,
      sessionRequestId: () => "session-request-id",
      requestSession,
      createOperationId: () => "operation-id",
      environment: fixture.environment,
      onQuote,
    });

    await lifecycle.refresh();
    expect(requestSession).not.toHaveBeenCalled();
    fixture.advance(60_000);
    await lifecycle.refresh();

    expect(requestSession).toHaveBeenCalledWith({
      qrToken: "qr-token",
      deviceId: "device-id",
      sessionRequestId: "session-request-id",
      orderingMode: "DEFAULT",
      includeMenu: false,
    }, "operation-id");
    expect(onQuote).toHaveBeenCalledWith({
      estimatedWaitMinMinutes: 18,
      estimatedWaitMaxMinutes: 24,
      waitAcknowledgmentThresholdMinutes: 20,
      requiresWaitAcknowledgment: true,
      resetWaitAcknowledgment: true,
    });
    expect(fixture.scheduleInterval).toHaveBeenCalledWith(expect.any(Function), 15_000);

    lifecycle.stop();
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reuses an operation id after infrastructure failure and stops after terminal session failure", async () => {
    const fixture = capacityEnvironment();
    const requestSession = vi.fn<QrOrderCapacityTransport>()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        payload: { code: "DATABASE_UNAVAILABLE" },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        payload: { code: "INVALID_SESSION_REQUEST" },
      });
    let operation = 0;
    const lifecycle = startQrOrderCapacityLifecycle({
      qrToken: "qr-token",
      deviceId: "device-id",
      orderingMode: "DELIVERY",
      orderSessionToken: "session-token",
      expiresAt,
      currentQuote: {
        estimatedWaitMinMinutes: 5,
        estimatedWaitMaxMinutes: 10,
        requiresWaitAcknowledgment: false,
      },
      sessionReady: () => true,
      sessionRequestId: () => "session-request-id",
      requestSession,
      createOperationId: () => `operation-${++operation}`,
      environment: fixture.environment,
      onQuote: vi.fn(),
    });

    fixture.advance(60_000);
    await lifecycle.refresh();
    fixture.advance(60_000);
    await lifecycle.refresh();
    fixture.advance(60_000);
    await lifecycle.refresh();

    expect(requestSession).toHaveBeenCalledTimes(2);
    expect(requestSession.mock.calls.map(([, operationId]) => operationId)).toEqual([
      "operation-1",
      "operation-1",
    ]);
    lifecycle.stop();
  });

  it("does not refresh capacity for preorder sessions", async () => {
    const fixture = capacityEnvironment();
    const requestSession = vi.fn<QrOrderCapacityTransport>();
    const lifecycle = startQrOrderCapacityLifecycle({
      qrToken: "qr-token",
      deviceId: "device-id",
      orderingMode: "PREORDER",
      orderSessionToken: "session-token",
      expiresAt,
      currentQuote: {
        estimatedWaitMinMinutes: 5,
        estimatedWaitMaxMinutes: 10,
        requiresWaitAcknowledgment: false,
      },
      sessionReady: () => true,
      sessionRequestId: () => "session-request-id",
      requestSession,
      environment: fixture.environment,
      onQuote: vi.fn(),
    });

    fixture.advance(120_000);
    await lifecycle.refresh();
    expect(requestSession).not.toHaveBeenCalled();
    lifecycle.stop();
  });
});

function capacityEnvironment() {
  let now = startedAt;
  const visibility: DocumentVisibilityState = "visible";
  const scheduleInterval = vi.fn(() => 1);
  const cancelInterval = vi.fn();
  const unsubscribe = vi.fn();
  return {
    scheduleInterval,
    unsubscribe,
    advance(milliseconds: number) {
      now += milliseconds;
    },
    environment: {
      now: () => now,
      visibilityState: () => visibility,
      scheduleInterval,
      cancelInterval,
      subscribeVisibility: () => unsubscribe,
    } satisfies QrOrderCapacityEnvironment,
  };
}
