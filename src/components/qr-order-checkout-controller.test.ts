import { describe, expect, it, vi } from "vitest";
import {
  submitQrOrderCheckout,
  type QrOrderCheckoutTransport,
} from "./qr-order-checkout-controller";

describe("QR order checkout controller", () => {
  it("owns create-public-order transport, cart cleanup, and navigation", async () => {
    const requestOrder = vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
      ok: true,
      status: 200,
      payload: { trackingToken: "tracking-token" },
    });
    const effects = checkoutEffects();

    await submitQrOrderCheckout({
      body: { qrToken: "qr-token", items: [{ productId: "meal", quantity: 1 }] },
      operationId: "operation-id",
      networkError: "network error",
      localizeError: (code) => `localized:${code}`,
      requestOrder,
      ...effects,
    });

    expect(requestOrder).toHaveBeenCalledWith({
      qrToken: "qr-token",
      items: [{ productId: "meal", quantity: 1 }],
    }, "operation-id");
    expect(effects.onSubmittingChange.mock.calls).toEqual([[true], [false]]);
    expect(effects.clearPersistedCart).toHaveBeenCalledTimes(1);
    expect(effects.navigateToOrder).toHaveBeenCalledWith("tracking-token");
    expect(effects.onMessage).toHaveBeenCalledWith("");
  });

  it("updates the quote and preserves the localized wait-acknowledgment error", async () => {
    const requestOrder = vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
      ok: false,
      status: 409,
      payload: {
        code: "WAIT_ACKNOWLEDGMENT_REQUIRED",
        capacity: {
          estimatedWaitMinMinutes: 20,
          estimatedWaitMaxMinutes: 30,
        },
      },
    });
    const effects = checkoutEffects();

    await submitQrOrderCheckout({
      body: { qrToken: "qr-token" },
      operationId: "operation-id",
      networkError: "network error",
      localizeError: (code) => `localized:${code}`,
      requestOrder,
      ...effects,
    });

    expect(effects.onWaitAcknowledgmentRequired).toHaveBeenCalledWith({
      estimatedWaitMinMinutes: 20,
      estimatedWaitMaxMinutes: 30,
    });
    expect(effects.onMessage).toHaveBeenLastCalledWith(
      "localized:WAIT_ACKNOWLEDGMENT_REQUIRED",
    );
    expect(effects.navigateToOrder).not.toHaveBeenCalled();
  });

  it("invalidates Turnstile identity and maps transport failure to the network message", async () => {
    const invalidTurnstileEffects = checkoutEffects();
    await submitQrOrderCheckout({
      body: { qrToken: "qr-token" },
      operationId: "operation-id",
      networkError: "network error",
      localizeError: (code) => `localized:${code}`,
      requestOrder: vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
        ok: false,
        status: 422,
        payload: { code: "INVALID_TURNSTILE" },
      }),
      ...invalidTurnstileEffects,
    });
    expect(invalidTurnstileEffects.onInvalidTurnstile).toHaveBeenCalledTimes(1);
    expect(invalidTurnstileEffects.onMessage).toHaveBeenLastCalledWith(
      "localized:INVALID_TURNSTILE",
    );

    const networkEffects = checkoutEffects();
    await submitQrOrderCheckout({
      body: { qrToken: "qr-token" },
      operationId: "operation-id",
      networkError: "network error",
      localizeError: (code) => `localized:${code}`,
      requestOrder: vi.fn<QrOrderCheckoutTransport>().mockRejectedValue(new Error("offline")),
      ...networkEffects,
    });
    expect(networkEffects.onMessage).toHaveBeenLastCalledWith("network error");
    expect(networkEffects.onSubmittingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("still navigates when best-effort cart cleanup is unavailable", async () => {
    const effects = checkoutEffects();
    effects.clearPersistedCart.mockImplementation(() => {
      throw new Error("storage blocked");
    });

    await submitQrOrderCheckout({
      body: { qrToken: "qr-token" },
      operationId: "operation-id",
      networkError: "network error",
      localizeError: (code) => `localized:${code}`,
      requestOrder: vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
        ok: true,
        status: 200,
        payload: { trackingToken: "tracking-token" },
      }),
      ...effects,
    });

    expect(effects.navigateToOrder).toHaveBeenCalledWith("tracking-token");
  });
});

function checkoutEffects() {
  return {
    onMessage: vi.fn(),
    onSubmittingChange: vi.fn(),
    onWaitAcknowledgmentRequired: vi.fn(),
    onInvalidTurnstile: vi.fn(),
    clearPersistedCart: vi.fn(),
    navigateToOrder: vi.fn(),
  };
}
