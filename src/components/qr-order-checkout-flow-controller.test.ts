import { describe, expect, it, vi } from "vitest";
import {
  createQrOrderCheckoutModel,
  submitQrOrderEditFlowCheckout,
  submitQrOrderFlowCheckout,
  type QrOrderCheckoutFlowEffects,
} from "@/components/qr-order-checkout-controller";
import { createQrOrderSessionController } from "@/components/qr-order-session-controller";
import type { QrOrderSession } from "@/components/qr-order-flow-orchestration";
import type { QrOrderCheckoutTransport } from "@/components/qr-order-checkout-controller";

const messages = {
  orderingUnavailable: "ordering unavailable",
  emptyCart: "empty cart",
  unappliedFulfillmentTime: "apply fulfillment time",
  sessionLoading: "session loading",
  sessionExpired: "session expired",
  customerDetailsMissing: "customer details missing",
  deliveryDetailsMissing: "delivery details missing",
  preorderTimeRequired: "preorder time required",
  productUnavailable: "product unavailable",
  invoiceDetailsInvalid: "invoice details invalid",
  waitAcknowledgmentRequired: "wait acknowledgment required",
  securityRequired: "security required",
  requiredNotes: (productName: string) => `required:${productName}`,
};

describe("QR order checkout flow controller", () => {
  it.each([
    {
      name: "pickup without a customer name",
      overrides: { customerName: "" },
      expected: "customer details missing",
    },
    {
      name: "pickup without a valid phone number",
      overrides: { customerPhone: "bad" },
      expected: "customer details missing",
    },
    {
      name: "delivery without a customer name",
      overrides: {
        orderingMode: "DELIVERY" as const,
        session: session("DELIVERY"),
        customerName: "",
      },
      expected: "customer details missing",
    },
    {
      name: "delivery without an address",
      overrides: {
        orderingMode: "DELIVERY" as const,
        session: session("DELIVERY"),
        deliveryAddress: "",
      },
      expected: "delivery details missing",
    },
  ])("blocks $name", ({ overrides, expected }) => {
    expect(createQrOrderCheckoutModel(checkoutInput({
      entryChannel: "SHARED_LINK",
      ...overrides,
    })).blocker).toBe(expected);
  });

  it("derives blocker and selected items from the same delivery validation contract", () => {
    const checkout = createQrOrderCheckoutModel(checkoutInput({
      entryChannel: "SHARED_LINK",
      orderingMode: "DELIVERY",
      session: session("DELIVERY"),
      customerPhone: "bad",
      deliveryAddress: "",
    }));

    expect(checkout.blocker).toBe("customer details missing");
    expect(checkout.selectedItems).toEqual([{
      productId: "meal",
      quantity: 1,
      note: "",
      noteOptionIds: [],
      bundleChoiceIds: [],
    }]);
  });

  it("does not require or submit customer identity for direct QR orders", async () => {
    const requestOrder = vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
      ok: true,
      status: 200,
      payload: { trackingToken: "tracking-token" },
    });
    const input = checkoutInput({
      entryChannel: "QR",
      customerName: "stored name",
      customerPhone: "0912345678",
    });

    expect(createQrOrderCheckoutModel({
      ...input,
      customerName: "",
      customerPhone: "",
    }).blocker).toBe("");
    await submitQrOrderFlowCheckout({
      input,
      sessionController: checkoutSessionController(),
      networkError: "network",
      localizeError: (code) => `localized:${code}`,
      requestOrder,
      effects: checkoutEffects(),
    });

    expect(requestOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: "", customerPhone: "" }),
      "operation-1",
    );
  });

  it("allows dine-in checkout without customer name or phone", () => {
    const dineInSession = session("DEFAULT");
    dineInSession.stall = {
      ...dineInSession.stall,
      fulfillmentType: "DINE_IN",
      table: { id: "table-1", code: "A1", label: "A1" },
    };

    expect(createQrOrderCheckoutModel(checkoutInput({
      session: dineInSession,
      customerName: "",
      customerPhone: "",
      deliveryAddress: "",
    })).blocker).toBe("");
  });

  it("preserves UI blocker priority and submission guard priority", async () => {
    const input = checkoutInput({
      orderingAvailability: "DEGRADED",
      orderingEnabled: false,
      cartLines: [],
      hasUnappliedFulfillmentTime: true,
      sessionReady: false,
      turnstileToken: null,
    });
    const requestOrder = vi.fn<QrOrderCheckoutTransport>();
    const effects = checkoutEffects();

    expect(createQrOrderCheckoutModel(input).blocker).toBe("ordering unavailable");
    await expect(submitQrOrderFlowCheckout({
      input,
      sessionController: checkoutSessionController(),
      networkError: "network",
      localizeError: (code) => `localized:${code}`,
      requestOrder,
      effects,
    })).resolves.toBe("BLOCKED");
    expect(effects.onMessage).toHaveBeenCalledWith("ordering unavailable");
    expect(requestOrder).not.toHaveBeenCalled();
  });

  it("reuses checkout identity on network retry and owns success cleanup/navigation", async () => {
    const controller = checkoutSessionController();
    const requestOrder = vi.fn<QrOrderCheckoutTransport>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        payload: { trackingToken: "tracking-token" },
      });
    const effects = checkoutEffects();
    const input = checkoutInput();

    await submitQrOrderFlowCheckout({
      input,
      sessionController: controller,
      networkError: "network",
      localizeError: (code) => `localized:${code}`,
      requestOrder,
      effects,
    });
    await submitQrOrderFlowCheckout({
      input,
      sessionController: controller,
      networkError: "network",
      localizeError: (code) => `localized:${code}`,
      requestOrder,
      effects,
    });

    expect(effects.onMessage).toHaveBeenCalledWith("network");
    expect(requestOrder).toHaveBeenCalledTimes(2);
    expect(requestOrder.mock.calls[0]).toEqual(requestOrder.mock.calls[1]);
    expect(requestOrder.mock.calls[1][0]).toMatchObject({
      qrToken: "qr-token",
      orderSessionToken: "session-token",
      idempotencyKey: "uuid-1",
      clientOrderId: "uuid-2",
      turnstileIdempotencyKey: "uuid-3",
      lotteryDrawId: "draw-1",
      items: [{ productId: "meal", quantity: 1 }],
    });
    expect(requestOrder.mock.calls[1][1]).toBe("operation-1");
    expect(effects.clearPersistedCart).toHaveBeenCalledOnce();
    expect(effects.navigateToOrder).toHaveBeenCalledWith("tracking-token");
  });

  it("updates the tracked order instead of creating a second order in edit mode", async () => {
    const requestOrder = vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
      ok: true,
      status: 200,
      payload: { trackingToken: "tracked-order-token", orderStatus: "WAITING_CONFIRMATION" },
    });
    const effects = checkoutEffects();

    await submitQrOrderEditFlowCheckout({
      input: checkoutInput(),
      trackingToken: "tracked-order-token",
      sessionController: checkoutSessionController(),
      networkError: "network",
      localizeError: (code) => `localized:${code}`,
      requestOrder,
      effects,
    });

    expect(requestOrder).toHaveBeenCalledWith({
      deviceId: "device-id",
      idempotencyKey: "uuid-1",
      turnstileToken: "turnstile-token",
      customerName: "Lin",
      customerPhone: "0912345678",
      deliveryAddress: "Taipei",
      customerNote: "less ice",
      items: [{
        productId: "meal",
        quantity: 1,
        note: "",
        noteOptionIds: [],
        bundleChoiceIds: [],
      }],
    }, "operation-1");
    expect(effects.clearPersistedCart).toHaveBeenCalledOnce();
    expect(effects.navigateToOrder).toHaveBeenCalledWith("tracked-order-token");
  });

  it("applies wait-capacity failure through a session updater and resets acknowledgment", async () => {
    const effects = checkoutEffects();
    const current = session("DEFAULT");
    effects.onSessionUpdate.mockImplementation((update) => {
      Object.assign(current, update(current));
    });

    await submitQrOrderFlowCheckout({
      input: checkoutInput(),
      sessionController: checkoutSessionController(),
      networkError: "network",
      localizeError: (code) => `localized:${code}`,
      requestOrder: vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
        ok: false,
        status: 409,
        payload: {
          code: "WAIT_ACKNOWLEDGMENT_REQUIRED",
          capacity: {
            estimatedWaitMinMinutes: 20,
            estimatedWaitMaxMinutes: 30,
          },
        },
      }),
      effects,
    });

    expect(current).toMatchObject({
      estimatedWaitMinutes: 30,
      estimatedWaitMinMinutes: 20,
      estimatedWaitMaxMinutes: 30,
      requiresWaitAcknowledgment: true,
    });
    expect(effects.onWaitAcknowledgmentReset).toHaveBeenCalledOnce();
    expect(effects.onMessage).toHaveBeenLastCalledWith(
      "localized:WAIT_ACKNOWLEDGMENT_REQUIRED",
    );
  });

  it("clears retry identity and Turnstile state only for INVALID_TURNSTILE", async () => {
    const controller = checkoutSessionController();
    const clearIdentity = vi.spyOn(controller, "clearCheckoutIdentity");
    const effects = checkoutEffects();

    await submitQrOrderFlowCheckout({
      input: checkoutInput(),
      sessionController: controller,
      networkError: "network",
      localizeError: (code) => `localized:${code}`,
      requestOrder: vi.fn<QrOrderCheckoutTransport>().mockResolvedValue({
        ok: false,
        status: 422,
        payload: { code: "INVALID_TURNSTILE" },
      }),
      effects,
    });

    expect(clearIdentity).toHaveBeenCalledOnce();
    expect(effects.onTurnstileInvalid).toHaveBeenCalledOnce();
    expect(effects.onMessage).toHaveBeenLastCalledWith("localized:INVALID_TURNSTILE");
  });
});

function checkoutInput(overrides: Partial<Parameters<typeof createQrOrderCheckoutModel>[0]> = {}) {
  return {
    qrToken: "qr-token",
    entryChannel: "SHARED_LINK" as const,
    orderingAvailability: "AVAILABLE" as const,
    orderingEnabled: true,
    orderingMode: "DEFAULT" as const,
    hasUnappliedFulfillmentTime: false,
    sessionReady: true,
    sessionExpired: false,
    session: session("DEFAULT"),
    deviceId: "device-id",
    cartLines: [{
      id: "line-meal",
      productId: "meal",
      quantity: 1,
      note: "",
      noteOptionIds: [],
      bundleChoiceIds: [],
    }],
    visibleProducts: session("DEFAULT").products,
    customerName: "Lin",
    customerPhone: "0912345678",
    deliveryAddress: "Taipei",
    customerNote: "less ice",
    scheduledPickupAt: "",
    lotteryDrawId: "draw-1",
    waitAcknowledged: false,
    turnstileToken: "turnstile-token",
    invoiceBuyerSelection: null,
    localizedProductName: (product: { name: string }) => product.name,
    messages,
    ...overrides,
  };
}

function checkoutSessionController() {
  let uuid = 0;
  let operation = 0;
  return createQrOrderSessionController({
    requestSession: vi.fn(),
    createUuid: () => `uuid-${++uuid}`,
    createOperationId: () => `operation-${++operation}`,
  });
}

function checkoutEffects() {
  return {
    onMessage: vi.fn(),
    onSubmittingChange: vi.fn(),
    onSessionUpdate: vi.fn(),
    onWaitAcknowledgmentReset: vi.fn(),
    onTurnstileInvalid: vi.fn(),
    clearPersistedCart: vi.fn(),
    navigateToOrder: vi.fn(),
  } satisfies QrOrderCheckoutFlowEffects;
}

function session(orderingMode: QrOrderSession["orderingMode"]): QrOrderSession {
  return {
    orderingMode,
    preorderSlots: orderingMode === "PREORDER" ? ["2026-08-13T02:00:00.000Z"] : [],
    lotteryEnabled: orderingMode === "DEFAULT",
    orderSessionToken: "session-token",
    expiresAt: "2099-08-13T00:15:00.000Z",
    stall: {
      name: "Test stall",
      slug: "test-stall",
      location: "Taipei",
      currency: "TWD",
      timezone: "Asia/Taipei",
      fulfillmentType: orderingMode === "DELIVERY" ? "DELIVERY" : "TAKEOUT",
      table: null,
    },
    products: [{
      id: "meal",
      name: "Meal",
      description: "",
      price: 100,
      kind: "SINGLE",
      category: "main",
      rank: null,
      isBestSeller: false,
      isSoldOut: false,
      isOrderDiscountEligible: true,
      imageUrl: null,
      translations: [],
      noteGroups: [],
      bundleChoiceGroups: [],
    }],
    supportedLocales: ["zh-TW"],
    estimatedWaitMinutes: 10,
    estimatedWaitMinMinutes: 5,
    estimatedWaitMaxMinutes: 10,
    waitAcknowledgmentThresholdMinutes: null,
    requiresWaitAcknowledgment: false,
    lastTableOrderAt: null,
    limits: {
      maxItemQuantity: 20,
      maxUniqueProducts: 10,
      maxTotalQuantity: 30,
      maxNoteLength: 200,
    },
  };
}
