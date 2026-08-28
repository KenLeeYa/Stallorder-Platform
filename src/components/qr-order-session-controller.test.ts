import { describe, expect, it, vi } from "vitest";
import { serializeQrCartDraft } from "@/lib/qr-cart";
import type { PublicMenu } from "@/lib/public-menu-types";
import {
  createQrOrderSessionController,
  type QrSessionTransport,
} from "./qr-order-session-controller";

const now = Date.parse("2026-08-13T00:00:00.000Z");
const pickupSlot = "2026-08-13T02:00:00.000Z";

function menu(orderingMode: PublicMenu["orderingMode"]): PublicMenu {
  return {
    orderingMode,
    preorderSlots: orderingMode === "DEFAULT" ? [] : [pickupSlot],
    lotteryEnabled: orderingMode === "DEFAULT",
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
    supportedLocales: ["zh-TW", "en"],
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

function sessionPayload(orderingMode: PublicMenu["orderingMode"]) {
  return {
    ...menu(orderingMode),
    orderSessionToken: `${orderingMode.toLowerCase()}-session`,
    expiresAt: "2026-08-13T00:15:00.000Z",
  };
}

function identities() {
  let requestId = 0;
  let operationId = 0;
  return {
    createUuid: vi.fn(() => `request-${++requestId}`),
    createOperationId: vi.fn(() => `operation-${++operationId}`),
  };
}

describe("QR order session controller", () => {
  it("reuses one identity while reloading a resolved shared-link menu and restores its cart", async () => {
    const requestSession = vi.fn<QrSessionTransport>()
      .mockResolvedValueOnce({ ok: true, status: 200, payload: sessionPayload("PREORDER") })
      .mockResolvedValueOnce({ ok: true, status: 200, payload: sessionPayload("PREORDER") });
    const controller = createQrOrderSessionController({ requestSession, ...identities() });
    const rawDraft = serializeQrCartDraft({
      orderingMode: "PREORDER",
      scheduledPickupAt: pickupSlot,
      customerName: "Lin",
      customerNote: "less ice",
      customerPhone: "",
      deliveryAddress: "",
      lines: [{
        id: "line-meal",
        productId: "meal",
        quantity: 1,
        note: "",
        noteOptionIds: [],
        bundleChoiceIds: [],
      }],
    }, now);
    const loadCartDraft = vi.fn(() => rawDraft);

    const result = await controller.start({
      qrToken: "qr-token",
      deviceId: "device-id",
      activeOrderingMode: "DEFAULT",
      entryChannel: "SHARED_LINK",
      initialMenu: menu("DEFAULT"),
      currentScheduledPickupAt: "",
      loadCartDraft,
      now,
    });

    expect(requestSession).toHaveBeenCalledTimes(2);
    expect(requestSession.mock.calls.map(([request]) => request.includeMenu)).toEqual([false, true]);
    expect(requestSession.mock.calls.map(([request]) => request.sessionRequestId)).toEqual([
      "request-1",
      "request-1",
    ]);
    expect(requestSession.mock.calls.map(([, operationId]) => operationId)).toEqual([
      "operation-1",
      "operation-1",
    ]);
    expect(loadCartDraft).toHaveBeenCalledWith("PREORDER");
    expect(result).toMatchObject({
      kind: "SESSION",
      session: { orderingMode: "PREORDER", orderSessionToken: "preorder-session" },
      cartRecovery: {
        restored: true,
        scheduledPickupAt: pickupSlot,
        customerName: "Lin",
        lines: [{ productId: "meal" }],
      },
    });
  });

  it("keeps PREORDER and DELIVERY shared-link contracts but rejects them at a QR entry", async () => {
    const sharedController = createQrOrderSessionController({
      requestSession: vi.fn<QrSessionTransport>().mockResolvedValue({
        ok: true,
        status: 200,
        payload: sessionPayload("DELIVERY"),
      }),
      ...identities(),
    });
    const qrController = createQrOrderSessionController({
      requestSession: vi.fn<QrSessionTransport>().mockResolvedValue({
        ok: true,
        status: 200,
        payload: sessionPayload("PREORDER"),
      }),
      ...identities(),
    });

    await expect(sharedController.start({
      qrToken: "shared",
      deviceId: "device",
      activeOrderingMode: "DELIVERY",
      entryChannel: "SHARED_LINK",
      initialMenu: menu("DELIVERY"),
      currentScheduledPickupAt: "",
    })).resolves.toMatchObject({
      kind: "SESSION",
      session: { orderingMode: "DELIVERY" },
    });
    await expect(qrController.start({
      qrToken: "qr",
      deviceId: "device",
      activeOrderingMode: "DEFAULT",
      entryChannel: "QR",
      initialMenu: menu("PREORDER"),
      currentScheduledPickupAt: "",
    })).resolves.toMatchObject({
      kind: "FAILURE",
      reason: "ENTRY_MODE",
      code: "QR_NOT_ACTIVE",
    });
  });

  it("rotates session identity only after a terminal client response", async () => {
    const requestSession = vi.fn<QrSessionTransport>()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        payload: { code: "INVALID_SESSION_REQUEST" },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, payload: sessionPayload("DEFAULT") });
    const controller = createQrOrderSessionController({ requestSession, ...identities() });
    const input = {
      qrToken: "qr-token",
      deviceId: "device-id",
      activeOrderingMode: "DEFAULT" as const,
      entryChannel: "QR" as const,
      initialMenu: menu("DEFAULT"),
      currentScheduledPickupAt: "",
    };

    await expect(controller.start(input)).resolves.toMatchObject({
      kind: "FAILURE",
      reason: "EDGE",
      code: "INVALID_SESSION_REQUEST",
    });
    await expect(controller.start(input)).resolves.toMatchObject({ kind: "SESSION" });

    expect(requestSession.mock.calls.map(([request]) => request.sessionRequestId)).toEqual([
      "request-1",
      "request-2",
    ]);
    expect(requestSession.mock.calls.map(([, operationId]) => operationId)).toEqual([
      "operation-1",
      "operation-2",
    ]);
  });

  it("suppresses an older session response after a newer attempt starts", async () => {
    let resolveFirst: ((value: Awaited<ReturnType<QrSessionTransport>>) => void) | undefined;
    const requestSession = vi.fn<QrSessionTransport>()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({ ok: true, status: 200, payload: sessionPayload("DEFAULT") });
    const controller = createQrOrderSessionController({ requestSession, ...identities() });
    const input = {
      qrToken: "qr-token",
      deviceId: "device-id",
      activeOrderingMode: "DEFAULT" as const,
      entryChannel: "QR" as const,
      initialMenu: menu("DEFAULT"),
      currentScheduledPickupAt: "",
    };

    const first = controller.start(input);
    await expect(controller.start(input)).resolves.toMatchObject({ kind: "SESSION", attempt: 2 });
    resolveFirst?.({ ok: true, status: 200, payload: sessionPayload("DEFAULT") });

    await expect(first).resolves.toEqual({ kind: "STALE", attempt: 1 });
  });

  it("owns checkout idempotency across equal, changed, and cleared fingerprints", () => {
    let uuid = 0;
    let operation = 0;
    const controller = createQrOrderSessionController({
      requestSession: vi.fn<QrSessionTransport>(),
      createUuid: () => `uuid-${++uuid}`,
      createOperationId: () => `operation-${++operation}`,
    });

    const first = controller.checkoutIdentity("same-cart");
    expect(controller.checkoutIdentity("same-cart")).toBe(first);
    const changed = controller.checkoutIdentity("changed-cart");
    expect(changed).not.toBe(first);
    controller.clearCheckoutIdentity();
    const cleared = controller.checkoutIdentity("changed-cart");

    expect([first.key, changed.key, cleared.key]).toEqual(["uuid-1", "uuid-4", "uuid-7"]);
    expect([first.operationId, changed.operationId, cleared.operationId]).toEqual([
      "operation-1",
      "operation-2",
      "operation-3",
    ]);
  });
});
