import { describe, expect, it, vi } from "vitest";
import {
  submitQrOrderEditFlowCheckout,
  submitQrOrderCheckout,
  type QrOrderCheckoutFlowInput,
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

  it("does not misreport a committed order as failed when a post-order task needs attention", async () => {
    const effects = checkoutEffects();

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
      afterOrderCreated: vi.fn().mockResolvedValue("invoice needs attention"),
      ...effects,
    });

    expect(effects.clearPersistedCart).toHaveBeenCalledOnce();
    expect(effects.navigateToOrder).toHaveBeenCalledWith("tracking-token");
    expect(effects.onMessage).toHaveBeenLastCalledWith("invoice needs attention");
    expect(effects.onMessage).not.toHaveBeenCalledWith("network error");
  });

  it("does not misreport a committed order when a post-order task rejects", async () => {
    const effects = checkoutEffects();

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
      afterOrderCreated: vi.fn().mockRejectedValue(new Error("follow-up failed")),
      ...effects,
    });

    expect(effects.navigateToOrder).toHaveBeenCalledWith("tracking-token");
    expect(effects.onMessage).not.toHaveBeenCalledWith("network error");
  });

  it("saves a pickup edit with its restored phone even though edit mode has no session expiry", async () => {
    const requestOrder = vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
      ok: true,
      status: 200,
      payload: { trackingToken: "tracking-token" },
    });
    const effects = {
      ...checkoutEffects(),
      onSessionUpdate: vi.fn(),
      onWaitAcknowledgmentReset: vi.fn(),
      onTurnstileInvalid: vi.fn(),
    };
    const sessionController = {
      checkoutIdentity: vi.fn(() => ({
        key: "22222222-2222-4222-8222-222222222222",
        clientOrderId: "33333333-3333-4333-8333-333333333333",
        turnstileIdempotencyKey: "44444444-4444-4444-8444-444444444444",
        operationId: "55555555-5555-4555-8555-555555555555",
        fingerprint: "fingerprint",
      })),
      clearCheckoutIdentity: vi.fn(),
    };
    const product = {
      id: "66666666-6666-4666-8666-666666666666",
      name: "香酥雞排",
      description: "",
      price: 95,
      kind: "SINGLE" as const,
      category: "炸物",
      rank: null,
      isBestSeller: false,
      isSoldOut: false,
      isOrderDiscountEligible: true,
      imageUrl: null,
      translations: [],
      noteGroups: [],
      bundleChoiceGroups: [],
    };
    const input = {
      qrToken: "qr-token",
      entryChannel: "SHARED_LINK",
      orderingAvailability: "AVAILABLE",
      orderingEnabled: true,
      orderingMode: "PREORDER",
      hasUnappliedFulfillmentTime: false,
      sessionReady: true,
      sessionExpired: false,
      session: {
        orderingMode: "PREORDER",
        preorderSlots: ["2026-09-03T10:00:00.000Z"],
        lotteryEnabled: false,
        stall: {
          name: "測試攤位",
          slug: "test-stall",
          location: "台中",
          currency: "TWD",
          timezone: "Asia/Taipei",
          fulfillmentType: "TAKEOUT",
          table: null,
        },
        products: [product],
        supportedLocales: ["zh-TW"],
        estimatedWaitMinutes: 0,
        estimatedWaitMinMinutes: 0,
        estimatedWaitMaxMinutes: 0,
        waitAcknowledgmentThresholdMinutes: null,
        requiresWaitAcknowledgment: false,
        lastTableOrderAt: null,
        limits: {
          maxItemQuantity: 20,
          maxUniqueProducts: 20,
          maxTotalQuantity: 50,
          maxNoteLength: 300,
        },
        orderSessionToken: "",
        expiresAt: "",
      },
      deviceId: "11111111-1111-4111-8111-111111111111",
      cartLines: [{
        id: "line-1",
        productId: product.id,
        quantity: 2,
        note: "少鹽",
        noteOptionIds: [],
        bundleChoiceIds: [],
      }],
      visibleProducts: [product],
      customerName: "王小姐",
      customerPhone: "0912345678",
      deliveryAddress: "",
      customerNote: "到店取餐",
      scheduledPickupAt: "2026-09-03T10:00:00.000Z",
      lotteryDrawId: null,
      waitAcknowledged: false,
      turnstileToken: "verified-token",
      invoiceBuyerSelection: null,
      localizedProductName: (candidate) => candidate.name,
      messages: checkoutMessages(),
    } satisfies QrOrderCheckoutFlowInput;

    const result = await submitQrOrderEditFlowCheckout({
      input,
      trackingToken: "tracking-token",
      sessionController,
      networkError: "network error",
      localizeError: (code) => `localized:${code}`,
      requestOrder,
      effects,
    });

    expect(result).toBe("SUBMITTED");
    expect(requestOrder).toHaveBeenCalledWith(expect.objectContaining({
      customerName: "王小姐",
      customerPhone: "0912345678",
      items: [expect.objectContaining({ productId: product.id, quantity: 2 })],
    }), "55555555-5555-4555-8555-555555555555");
    expect(effects.navigateToOrder).toHaveBeenCalledWith("tracking-token");
  });
});

function checkoutMessages() {
  return {
    orderingUnavailable: "ordering unavailable",
    emptyCart: "empty cart",
    unappliedFulfillmentTime: "unapplied time",
    sessionLoading: "session loading",
    sessionExpired: "session expired",
    customerDetailsMissing: "customer details missing",
    deliveryDetailsMissing: "delivery details missing",
    waitAcknowledgmentRequired: "wait acknowledgment required",
    securityRequired: "security required",
    preorderTimeRequired: "preorder time required",
    productUnavailable: "product unavailable",
    invoiceDetailsInvalid: "invoice invalid",
    requiredNotes: (name: string) => `required:${name}`,
  };
}

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
