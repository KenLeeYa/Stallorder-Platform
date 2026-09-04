import { describe, expect, it, vi } from "vitest";
import { serializeQrCartDraft, type QrCartLine } from "@/lib/qr-cart";
import type { PublicMenu, PublicMenuProduct } from "@/lib/public-menu-types";
import {
  buildQrCartDraft,
  buildQrPublicOrderRequest,
  createQrCheckoutFingerprint,
  ensureQrSessionIdentity,
  normalizeQrOrderSession,
  qrEntryAllowsOrderingMode,
  resolveQrCheckoutIdentity,
  restoreQrOrderSessionCart,
  usableQrInitialMenu,
} from "./qr-order-flow-orchestration";

const now = Date.parse("2026-08-13T00:00:00.000Z");
const morningSlot = "2026-08-13T02:00:00.000Z";
const eveningSlot = "2026-08-13T10:00:00.000Z";
const limits = {
  maxItemQuantity: 20,
  maxUniqueProducts: 10,
  maxTotalQuantity: 30,
  maxNoteLength: 200,
};

function product(
  id: string,
  availability: Pick<PublicMenuProduct, "availableFrom" | "availableUntil"> = {},
): PublicMenuProduct {
  return {
    id,
    name: id,
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
    ...availability,
  };
}

function menu(
  orderingMode: PublicMenu["orderingMode"],
  overrides: Partial<PublicMenu> = {},
): PublicMenu {
  return {
    orderingMode,
    preorderSlots: orderingMode === "DEFAULT" ? [] : [morningSlot, eveningSlot],
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
    products: [product("always")],
    supportedLocales: ["zh-TW", "en"],
    estimatedWaitMinutes: 10,
    estimatedWaitMinMinutes: 5,
    estimatedWaitMaxMinutes: 10,
    waitAcknowledgmentThresholdMinutes: null,
    requiresWaitAcknowledgment: false,
    lastTableOrderAt: null,
    limits,
    ...overrides,
  };
}

function line(productId: string, id = `line-${productId}`): QrCartLine {
  return {
    id,
    productId,
    quantity: 1,
    note: "",
    noteOptionIds: [],
    bundleChoiceIds: [],
  };
}

describe("QR order flow characterization", () => {
  it("uses only DEFAULT SSR menu data for a QR entry", () => {
    const defaultMenu = menu("DEFAULT");

    expect(usableQrInitialMenu("QR", defaultMenu)).toBe(defaultMenu);
    expect(usableQrInitialMenu("QR", menu("PREORDER"))).toBeNull();
    expect(usableQrInitialMenu("QR", menu("DELIVERY"))).toBeNull();
  });

  it("keeps PREORDER and DELIVERY SSR menus for shared-link entries", () => {
    const preorder = menu("PREORDER");
    const delivery = menu("DELIVERY");

    expect(usableQrInitialMenu("SHARED_LINK", preorder)).toBe(preorder);
    expect(usableQrInitialMenu("SHARED_LINK", delivery)).toBe(delivery);
    expect(qrEntryAllowsOrderingMode("SHARED_LINK", "PREORDER")).toBe(true);
    expect(qrEntryAllowsOrderingMode("SHARED_LINK", "DELIVERY")).toBe(true);
    expect(qrEntryAllowsOrderingMode("QR", "PREORDER")).toBe(false);
  });

  it("normalizes resolved session menu defaults without enabling PREORDER lottery", () => {
    const session = normalizeQrOrderSession({
      ...menu("PREORDER"),
      orderSessionToken: "session-token",
      expiresAt: "2026-08-13T00:15:00.000Z",
      lotteryEnabled: true,
      lotteryReward: {
        spendEnabled: true,
        spendThresholdAmount: 666,
        festivalEnabled: true,
        festivalActive: true,
      },
      products: [{
        ...product("legacy-shape"),
        kind: "SINGLE",
        bundleChoiceGroups: undefined,
        rank: undefined,
        isBestSeller: undefined,
        isSoldOut: undefined,
        isOrderDiscountEligible: undefined,
      } as unknown as PublicMenuProduct],
    }, "DEFAULT");

    expect(session.orderingMode).toBe("PREORDER");
    expect(session.lotteryEnabled).toBe(false);
    expect(session.lotteryReward).toMatchObject({
      spendEnabled: false,
      festivalEnabled: false,
      festivalActive: false,
    });
    expect(session.products[0]).toMatchObject({
      kind: "SINGLE",
      bundleChoiceGroups: [],
      rank: null,
      isBestSeller: false,
      isSoldOut: false,
      isOrderDiscountEligible: true,
    });
  });

  it("fails closed for lottery campaigns in a stale DELIVERY session payload", () => {
    const session = normalizeQrOrderSession({
      ...menu("DELIVERY"),
      orderSessionToken: "delivery-session",
      expiresAt: "2026-08-13T00:15:00.000Z",
      lotteryEnabled: true,
      lotteryReward: {
        spendEnabled: true,
        spendThresholdAmount: 666,
        festivalEnabled: true,
        festivalActive: true,
      },
    }, "DELIVERY");

    expect(session.lotteryEnabled).toBe(false);
    expect(session.lotteryReward).toMatchObject({
      spendEnabled: false,
      festivalEnabled: false,
      festivalActive: false,
    });
  });

  it("restores a shared-link PREORDER cart at its saved slot and prunes unavailable products", () => {
    const session = normalizeQrOrderSession({
      ...menu("PREORDER", {
        products: [
          product("morning", { availableUntil: "2026-08-13T04:00:00.000Z" }),
          product("evening", { availableFrom: "2026-08-13T08:00:00.000Z" }),
        ],
      }),
      orderSessionToken: "session-token",
      expiresAt: "2026-08-13T00:15:00.000Z",
    }, "PREORDER");
    const raw = serializeQrCartDraft({
      orderingMode: "PREORDER",
      scheduledPickupAt: morningSlot,
      customerName: "Lin",
      customerNote: "less ice",
      customerPhone: "0912345678",
      deliveryAddress: "",
      lines: [line("morning"), line("evening")],
    }, now);

    expect(restoreQrOrderSessionCart({
      raw,
      session,
      currentScheduledPickupAt: "",
      now,
    })).toMatchObject({
      restored: true,
      scheduledPickupAt: morningSlot,
      draftScheduledPickupAt: morningSlot,
      lines: [{ productId: "morning" }],
      customerName: "Lin",
      customerNote: "less ice",
      customerPhone: "0912345678",
    });
  });

  it("restores a PREORDER cart when the saved and offered slots describe the same instant", () => {
    const offeredSlot = "2026-08-13T02:00:00+00:00";
    const session = normalizeQrOrderSession({
      ...menu("PREORDER", {
        preorderSlots: [offeredSlot],
        products: [product("morning", { availableUntil: "2026-08-13T04:00:00.000Z" })],
      }),
      orderSessionToken: "session-token",
      expiresAt: "2026-08-13T00:15:00.000Z",
    }, "PREORDER");
    const raw = serializeQrCartDraft({
      orderingMode: "PREORDER",
      scheduledPickupAt: "2026-08-13T02:00:00.000Z",
      customerName: "Lin",
      customerNote: "",
      customerPhone: "0912345678",
      deliveryAddress: "",
      lines: [line("morning")],
    }, now);

    expect(restoreQrOrderSessionCart({
      raw,
      session,
      currentScheduledPickupAt: "",
      now,
    })).toMatchObject({
      restored: true,
      scheduledPickupAt: offeredSlot,
      draftScheduledPickupAt: offeredSlot,
      lines: [{ productId: "morning" }],
      customerPhone: "0912345678",
    });
  });

  it("restores DELIVERY contact fields and an optional scheduled time", () => {
    const session = normalizeQrOrderSession({
      ...menu("DELIVERY"),
      orderSessionToken: "delivery-session",
      expiresAt: "2026-08-13T00:15:00.000Z",
    }, "DELIVERY");
    const raw = serializeQrCartDraft({
      orderingMode: "DELIVERY",
      scheduledPickupAt: eveningSlot,
      customerName: "Chen",
      customerNote: "call first",
      customerPhone: "+886912345678",
      deliveryAddress: "Taipei 101",
      lines: [line("always")],
    }, now);

    expect(restoreQrOrderSessionCart({
      raw,
      session,
      currentScheduledPickupAt: "",
      now,
    })).toMatchObject({
      restored: true,
      scheduledPickupAt: eveningSlot,
      customerPhone: "+886912345678",
      deliveryAddress: "Taipei 101",
      lines: [{ productId: "always" }],
    });
  });

  it("does not restore a cart from another ordering mode", () => {
    const session = normalizeQrOrderSession({
      ...menu("DEFAULT"),
      orderSessionToken: "qr-session",
      expiresAt: "2026-08-13T00:15:00.000Z",
    }, "DEFAULT");
    const raw = serializeQrCartDraft({
      orderingMode: "PREORDER",
      scheduledPickupAt: morningSlot,
      customerName: "Wrong mode",
      customerNote: "",
      customerPhone: "",
      deliveryAddress: "",
      lines: [line("always")],
    }, now);

    expect(restoreQrOrderSessionCart({
      raw,
      session,
      currentScheduledPickupAt: "",
      now,
    })).toMatchObject({ restored: false, scheduledPickupAt: "", lines: [] });
  });

  it("reuses session request identity until the caller explicitly clears it", () => {
    const createUuid = vi.fn(() => "session-request-1");
    const createOperationId = vi.fn(() => "session-operation-1");
    const created = ensureQrSessionIdentity(null, null, createUuid, createOperationId);

    expect(created).toEqual({
      sessionRequestId: "session-request-1",
      operationId: "session-operation-1",
    });
    expect(ensureQrSessionIdentity(
      created.sessionRequestId,
      created.operationId,
      createUuid,
      createOperationId,
    )).toEqual(created);
    expect(createUuid).toHaveBeenCalledTimes(1);
    expect(createOperationId).toHaveBeenCalledTimes(1);
  });

  it("keeps checkout idempotency for the same fingerprint and rotates all IDs after a cart change", () => {
    const createUuid = vi.fn()
      .mockReturnValueOnce("idempotency-1")
      .mockReturnValueOnce("client-order-1")
      .mockReturnValueOnce("turnstile-1")
      .mockReturnValueOnce("idempotency-2")
      .mockReturnValueOnce("client-order-2")
      .mockReturnValueOnce("turnstile-2");
    const createOperationId = vi.fn()
      .mockReturnValueOnce("operation-1")
      .mockReturnValueOnce("operation-2");
    const firstFingerprint = createQrCheckoutFingerprint({
      orderingMode: "DEFAULT",
      customerName: "Lin",
      customerPhone: "",
      deliveryAddress: "",
      customerNote: "",
      scheduledPickupAt: "",
      lotteryDrawId: null,
      selectedItems: [{ productId: "always", quantity: 1, note: "", noteOptionIds: [], bundleChoiceIds: [] }],
      waitAcknowledged: false,
    });
    const first = resolveQrCheckoutIdentity(null, firstFingerprint, createUuid, createOperationId);

    expect(resolveQrCheckoutIdentity(first, firstFingerprint, createUuid, createOperationId)).toBe(first);
    const changed = resolveQrCheckoutIdentity(
      first,
      firstFingerprint.replace('"quantity":1', '"quantity":2'),
      createUuid,
      createOperationId,
    );
    expect(changed).toEqual({
      key: "idempotency-2",
      clientOrderId: "client-order-2",
      turnstileIdempotencyKey: "turnstile-2",
      operationId: "operation-2",
      fingerprint: expect.any(String),
    });
  });

  it("sends fulfillment time only for shared links and preserves delivery details", () => {
    const base = {
      qrToken: "qr-token",
      orderSessionToken: "session-token",
      deviceId: "device-id",
      identity: {
        key: "idempotency-key",
        clientOrderId: "client-order-id",
        turnstileIdempotencyKey: "turnstile-key",
        operationId: "operation-id",
        fingerprint: "fingerprint",
      },
      customerName: "Chen",
      customerPhone: "+886912345678",
      deliveryAddress: "Taipei 101",
      customerNote: "call first",
      waitAcknowledged: true,
      orderingMode: "DELIVERY" as const,
      scheduledPickupAt: eveningSlot,
      lotteryDrawId: null,
      items: [{
        productId: "always",
        quantity: 1,
        note: "",
        noteOptionIds: [],
        bundleChoiceIds: [],
      }],
      turnstileToken: "turnstile-token",
    };

    expect(buildQrPublicOrderRequest({ ...base, entryChannel: "QR" }).body)
      .toMatchObject({ scheduledPickupAt: null, customerPhone: "+886912345678", deliveryAddress: "Taipei 101" });
    expect(buildQrPublicOrderRequest({ ...base, entryChannel: "SHARED_LINK" })).toEqual({
      body: expect.objectContaining({ scheduledPickupAt: eveningSlot }),
      operationId: "operation-id",
    });
  });

  it("persists delivery-only recovery fields but removes a completely empty QR draft", () => {
    expect(buildQrCartDraft({
      orderingMode: "DEFAULT",
      scheduledPickupAt: "",
      customerName: "",
      customerNote: "",
      customerPhone: "",
      deliveryAddress: "",
      lines: [],
    })).toBeNull();
    expect(buildQrCartDraft({
      orderingMode: "DELIVERY",
      scheduledPickupAt: eveningSlot,
      customerName: "",
      customerNote: "",
      customerPhone: "+886912345678",
      deliveryAddress: "Taipei 101",
      lines: [],
    })).toEqual({
      orderingMode: "DELIVERY",
      scheduledPickupAt: eveningSlot,
      customerName: "",
      customerNote: "",
      customerPhone: "+886912345678",
      deliveryAddress: "Taipei 101",
      lines: [],
    });
  });
});
