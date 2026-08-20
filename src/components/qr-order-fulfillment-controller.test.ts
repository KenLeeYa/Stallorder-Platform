import { describe, expect, it, vi } from "vitest";
import {
  applyQrOrderFulfillmentTime,
  buildQrOrderFulfillmentViewModel,
  selectQrOrderFulfillmentTime,
  type QrOrderFulfillmentEffects,
} from "@/components/qr-order-fulfillment-controller";
import type { QrOrderSession } from "@/components/qr-order-flow-orchestration";
import type { QrCartLine } from "@/lib/qr-cart";
import type { PublicMenuProduct } from "@/lib/public-menu-types";

const morningSlot = "2026-08-13T02:00:00.000Z";
const eveningSlot = "2026-08-13T10:00:00.000Z";

describe("QR order fulfillment controller", () => {
  it("builds the PREORDER picker/apply view model only for an eligible shared link", () => {
    const eligible = buildQrOrderFulfillmentViewModel({
      entryChannel: "SHARED_LINK",
      session: session("PREORDER"),
      orderingMode: "PREORDER",
      scheduledPickupAt: morningSlot,
      draftScheduledPickupAt: eveningSlot,
    });

    expect(eligible).toMatchObject({
      canSelect: true,
      value: eveningSlot,
      label: "預約取餐時間",
      scheduledLabel: "指定取餐時間",
      dateLabel: "預約取餐日期",
      timeLabel: "預約取餐時間",
      allowAsap: false,
      required: true,
      hasUnappliedTime: true,
      testId: "qr-preorder-fulfillment-time-fields",
    });
    expect(eligible.slots.map((slot) => slot.iso)).toEqual([morningSlot, eveningSlot]);

    expect(buildQrOrderFulfillmentViewModel({
      entryChannel: "QR",
      session: session("PREORDER"),
      orderingMode: "PREORDER",
      scheduledPickupAt: morningSlot,
      draftScheduledPickupAt: morningSlot,
    }).canSelect).toBe(false);
    expect(buildQrOrderFulfillmentViewModel({
      entryChannel: "SHARED_LINK",
      session: session("PREORDER", { fulfillmentType: "DINE_IN" }),
      orderingMode: "PREORDER",
      scheduledPickupAt: morningSlot,
      draftScheduledPickupAt: morningSlot,
    }).canSelect).toBe(false);
  });

  it("keeps PREORDER picker selection as a draft without applying or pruning", () => {
    const effects = fulfillmentEffects();

    const selected = selectQrOrderFulfillmentTime({
      value: eveningSlot,
      orderingMode: "PREORDER",
      session: session("PREORDER"),
      cartLines: [line("evening")],
    }, effects);

    expect(selected).toBe(true);
    expect(effects.onDraftChanged).toHaveBeenCalledWith(eveningSlot);
    expect(effects.onMessageCleared).toHaveBeenCalledOnce();
    expect(effects.onScheduleApplied).not.toHaveBeenCalled();
    expect(effects.onCartChanged).not.toHaveBeenCalled();
    expect(effects.onProductsReconciled).not.toHaveBeenCalled();
    expect(effects.onLotteryCleared).not.toHaveBeenCalled();
  });

  it("rejects an empty or unknown PREORDER apply without any state effects", () => {
    const effects = fulfillmentEffects();
    const preorder = session("PREORDER");

    expect(applyQrOrderFulfillmentTime({
      value: "",
      orderingMode: "PREORDER",
      session: preorder,
      cartLines: [],
    }, effects)).toBe(false);
    expect(applyQrOrderFulfillmentTime({
      value: "2026-08-14T02:00:00.000Z",
      orderingMode: "PREORDER",
      session: preorder,
      cartLines: [],
    }, effects)).toBe(false);
    expect(Object.values(effects).every((effect) => effect.mock.calls.length === 0)).toBe(true);
  });

  it("applies PREORDER and atomically prunes unavailable cart products and selections", () => {
    const effects = fulfillmentEffects();
    const cartLines = [
      line("morning"),
      { ...line("evening"), noteOptionIds: ["removed-note"] },
    ];
    const preorder = session("PREORDER");

    expect(applyQrOrderFulfillmentTime({
      value: eveningSlot,
      orderingMode: "PREORDER",
      session: preorder,
      cartLines,
    }, effects)).toBe(true);

    expect(effects.onScheduleApplied).toHaveBeenCalledWith(eveningSlot);
    expect(effects.onDraftChanged).toHaveBeenCalledWith(eveningSlot);
    expect(effects.onMessageCleared).toHaveBeenCalledOnce();
    expect(effects.onCartChanged).toHaveBeenCalledWith([
      { ...line("evening"), noteOptionIds: [] },
    ]);
    expect(effects.onProductsReconciled).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "evening" }), expect.objectContaining({ id: "always" })],
      [{ ...line("evening"), noteOptionIds: [] }],
    );
    expect(effects.onLotteryCleared).toHaveBeenCalledOnce();
  });

  it("applies DELIVERY/DEFAULT selection without PREORDER cart side effects", () => {
    const effects = fulfillmentEffects();
    const delivery = session("DELIVERY");

    expect(selectQrOrderFulfillmentTime({
      value: "",
      orderingMode: "DELIVERY",
      session: delivery,
      cartLines: [line("always")],
    }, effects)).toBe(true);
    expect(effects.onScheduleApplied).toHaveBeenCalledWith("");
    expect(effects.onDraftChanged).toHaveBeenCalledWith("");
    expect(effects.onMessageCleared).toHaveBeenCalledOnce();
    expect(effects.onCartChanged).not.toHaveBeenCalled();
    expect(effects.onProductsReconciled).not.toHaveBeenCalled();
    expect(effects.onLotteryCleared).not.toHaveBeenCalled();
  });
});

function fulfillmentEffects() {
  return {
    onScheduleApplied: vi.fn(),
    onDraftChanged: vi.fn(),
    onMessageCleared: vi.fn(),
    onCartChanged: vi.fn(),
    onProductsReconciled: vi.fn(),
    onLotteryCleared: vi.fn(),
  } satisfies QrOrderFulfillmentEffects;
}

function session(
  orderingMode: QrOrderSession["orderingMode"],
  stallOverrides: Partial<QrOrderSession["stall"]> = {},
): QrOrderSession {
  return {
    orderingMode,
    preorderSlots: [morningSlot, eveningSlot],
    lotteryEnabled: orderingMode === "DEFAULT",
    orderSessionToken: "session-token",
    expiresAt: "2026-08-13T00:15:00.000Z",
    stall: {
      name: "Test stall",
      slug: "test-stall",
      location: "Taipei",
      currency: "TWD",
      timezone: "Asia/Taipei",
      fulfillmentType: orderingMode === "DELIVERY" ? "DELIVERY" : "TAKEOUT",
      table: null,
      ...stallOverrides,
    },
    products: [
      product("morning", { availableUntil: eveningSlot }),
      product("evening", { availableFrom: eveningSlot }),
      product("always"),
    ],
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
    isOrderDiscountEligible: true,
    imageUrl: null,
    translations: [],
    noteGroups: [],
    bundleChoiceGroups: [],
    ...availability,
  };
}

function line(productId: string): QrCartLine {
  return {
    id: `line-${productId}`,
    productId,
    quantity: 1,
    note: "",
    noteOptionIds: [],
    bundleChoiceIds: [],
  };
}
