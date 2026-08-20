import { describe, expect, it } from "vitest";
import { resolveQrOrderSessionTransition } from "@/components/qr-order-session-application";
import type { QrOrderSession } from "@/components/qr-order-flow-orchestration";
import { localizedPublicOrderError, qrOrderMessages } from "@/lib/qr-order-i18n";

const now = Date.parse("2026-08-13T00:00:00.000Z");
const pickupSlot = "2026-08-13T02:00:00.000Z";

describe("QR order session application transition", () => {
  it("ignores stale attempts and exposes resume navigation without applying session state", () => {
    expect(resolveQrOrderSessionTransition({
      result: { kind: "STALE", attempt: 1 },
      browserLocale: "zh-TW",
      currentLocale: "zh-TW",
      hasUsableInitialMenu: false,
      currentAvailability: "CHECKING",
      now,
    })).toEqual({ kind: "STALE" });

    expect(resolveQrOrderSessionTransition({
      result: { kind: "RESUME", attempt: 2, trackingToken: "tracking-token" },
      browserLocale: "zh-TW",
      currentLocale: "zh-TW",
      hasUsableInitialMenu: false,
      currentAvailability: "AVAILABLE",
      now,
    })).toEqual({ kind: "RESUME", trackingToken: "tracking-token" });
  });

  it("keeps an explicit degraded failure instead of overwriting it with initial-menu fallback", () => {
    expect(resolveQrOrderSessionTransition({
      result: {
        kind: "FAILURE",
        attempt: 1,
        reason: "EDGE",
        code: "QR_ORDERING_DEGRADED",
        status: 503,
      },
      browserLocale: "en",
      currentLocale: "en",
      hasUsableInitialMenu: true,
      currentAvailability: "CHECKING",
      now,
    })).toEqual({
      kind: "FAILURE",
      availability: "DEGRADED",
      message: localizedPublicOrderError("en", "QR_ORDERING_DEGRADED"),
    });
  });

  it("maps network and invalid-resume failures to their dedicated UI messages", () => {
    expect(resolveQrOrderSessionTransition({
      result: {
        kind: "FAILURE",
        attempt: 1,
        reason: "NETWORK",
        code: "",
        status: null,
      },
      browserLocale: "zh-TW",
      currentLocale: "zh-TW",
      hasUsableInitialMenu: true,
      currentAvailability: "UNKNOWN",
      now,
    })).toEqual({
      kind: "FAILURE",
      availability: "UNAVAILABLE",
      message: qrOrderMessages["zh-TW"].networkError,
    });

    expect(resolveQrOrderSessionTransition({
      result: {
        kind: "FAILURE",
        attempt: 2,
        reason: "INVALID_RESUME",
        code: "INVALID_RESUME_ORDER",
        status: null,
      },
      browserLocale: "en",
      currentLocale: "en",
      hasUsableInitialMenu: false,
      currentAvailability: "DEGRADED",
      now,
    })).toEqual({
      kind: "FAILURE",
      availability: null,
      message: qrOrderMessages.en.sessionStartError,
    });
  });

  it("derives the complete restored PREORDER session transition", () => {
    const acceptedSession = session("PREORDER");
    const cartRecovery = {
      restored: true,
      scheduledPickupAt: pickupSlot,
      draftScheduledPickupAt: pickupSlot,
      lines: [{
        id: "line-meal",
        productId: "meal",
        quantity: 1,
        note: "",
        noteOptionIds: [],
        bundleChoiceIds: [],
      }],
      customerName: "Lin",
      customerNote: "less ice",
      customerPhone: "0912345678",
      deliveryAddress: "Taipei",
    };

    expect(resolveQrOrderSessionTransition({
      result: {
        kind: "SESSION",
        attempt: 3,
        session: acceptedSession,
        cartRecovery,
      },
      browserLocale: "zh-TW",
      currentLocale: "en",
      hasUsableInitialMenu: true,
      currentAvailability: "CHECKING",
      now,
    })).toEqual({
      kind: "SESSION",
      session: acceptedSession,
      cartRecovery,
      locale: "en",
      sessionTimePhase: "ACTIVE",
      availability: "AVAILABLE",
      resetPreorderLottery: true,
    });
  });
});

function session(orderingMode: QrOrderSession["orderingMode"]): QrOrderSession {
  return {
    orderingMode,
    preorderSlots: orderingMode === "DEFAULT" ? [] : [pickupSlot],
    lotteryEnabled: orderingMode === "DEFAULT",
    orderSessionToken: "session-token",
    expiresAt: "2026-08-13T00:15:00.000Z",
    stall: {
      name: "Test stall",
      slug: "test-stall",
      location: "Taipei",
      currency: "TWD",
      timezone: "Asia/Taipei",
      fulfillmentType: "TAKEOUT",
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
