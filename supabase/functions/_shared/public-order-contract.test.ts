import { describe, expect, it } from "vitest";
import {
  buildPublicOrderFailureBody,
  buildPublicOrderResponse,
  buildPublicOrderResumeResponse,
  buildPublicOrderSessionResponse,
  publicOrderItemsToRpc,
  publicOrderNeedsPickupCode,
  publicOrderSessionAbuseBehavior,
  publicOrderSubmissionAbuseBehavior,
  resolveStoredPickupCode,
} from "./public-order-contract";

describe("canonical public order pure contract", () => {
  const storedOrder = {
    order_id: "11111111-1111-4111-8111-111111111111",
    order_no: "A001",
    order_status: "WAITING_CONFIRMATION",
    payment_status: "UNPAID",
    total_amount: 125,
    fulfillment_type: "TAKEOUT",
    pickup_required: true,
    quoted_wait_minutes: 12,
    quoted_ready_at: "2026-08-13T04:12:00.000Z",
    scheduled_pickup_at: null,
    requested_fulfillment_at: null,
    discount_amount: 5,
    created_at: "2026-08-13T04:00:00.000Z",
  };

  it("serializes one successful order body for either transport", () => {
    expect(buildPublicOrderResponse(
      storedOrder,
      "tracking-token",
      "123456",
      "2026-08-13T04:00:00.000Z",
    )).toEqual({
      orderNo: "A001",
      trackingToken: "tracking-token",
      pickupVerificationCode: "123456",
      fulfillmentType: "TAKEOUT",
      orderStatus: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID",
      totalAmount: 125,
      quotedWaitMinutes: 12,
      quotedReadyAt: "2026-08-13T04:12:00.000Z",
      scheduledPickupAt: null,
      requestedFulfillmentAt: null,
      discountAmount: 5,
      createdAt: "2026-08-13T04:00:00.000Z",
    });
    expect(publicOrderNeedsPickupCode(storedOrder)).toBe(true);
    expect(publicOrderNeedsPickupCode({
      ...storedOrder,
      fulfillment_type: "DELIVERY",
      pickup_required: false,
    })).toBe(false);
  });

  it("maps command lines once for canonical preflight and create RPCs", () => {
    expect(publicOrderItemsToRpc([{
      productId: "22222222-2222-4222-8222-222222222222",
      quantity: 2,
      note: "少冰",
      noteOptionIds: ["33333333-3333-4333-8333-333333333333"],
      bundleChoiceIds: ["44444444-4444-4444-8444-444444444444"],
    }])).toEqual([{
      product_id: "22222222-2222-4222-8222-222222222222",
      quantity: 2,
      note: "少冰",
      modifier_option_ids: ["33333333-3333-4333-8333-333333333333"],
      bundle_choice_ids: ["44444444-4444-4444-8444-444444444444"],
    }]);
  });

  it("keeps the atomically allocated pickup code and falls back for legacy orders", () => {
    expect(resolveStoredPickupCode({ pickup_code_display: "042" }, "817")).toBe("042");
    expect(resolveStoredPickupCode({ pickup_code_display: null }, "817")).toBe("817");
    expect(resolveStoredPickupCode({ pickup_code_display: "invalid" }, "817")).toBe("817");
    expect(resolveStoredPickupCode({ pickup_code_display: "123456" }, "817")).toBe("123456");
  });

  it("locks the abuse-behavior keys shared by both physical attempts", () => {
    expect(publicOrderSessionAbuseBehavior({
      orderingMode: "DEFAULT",
      clientIp: "203.0.113.8",
      deviceId: "device-id",
      qrToken: "qr-token",
    })).toBe("scan:DEFAULT:203.0.113.8:device-id:qr-token");
    expect(publicOrderSubmissionAbuseBehavior({
      orderingMode: "PREORDER",
      deviceId: "device-id",
      qrToken: "qr-token",
      scheduledPickupAt: "2026-08-13T04:00:00.000Z",
      lotteryDrawId: null,
      canonicalItems: "canonical-lines",
    })).toBe(
      "order:PREORDER:device-id:qr-token:2026-08-13T04:00:00.000Z::canonical-lines",
    );
  });

  it("serializes terminal capacity detail without transport-specific branching", () => {
    expect(buildPublicOrderFailureBody(
      "WAIT_ACKNOWLEDGMENT_REQUIRED",
      "請確認等候時間",
      {
        quote_min_minutes: 20,
        quote_max_minutes: 35,
        requires_acknowledgment: true,
      },
    )).toEqual({
      error: "請確認等候時間",
      code: "WAIT_ACKNOWLEDGMENT_REQUIRED",
      capacity: {
        estimatedWaitMinMinutes: 20,
        estimatedWaitMaxMinutes: 35,
        requiresWaitAcknowledgment: true,
      },
    });
  });

  it("serializes immediate, preorder, and resume session contracts", () => {
    expect(buildPublicOrderSessionResponse({
      orderSessionToken: "session-token",
      expiresAt: "2026-08-13T04:10:00.000Z",
      orderingMode: "DEFAULT",
      capacity: {
        quote_min_minutes: 10,
        quote_max_minutes: 15,
        acknowledgment_threshold_minutes: 20,
        requires_acknowledgment: true,
      },
    })).toMatchObject({
      estimatedWaitMinutes: 15,
      estimatedWaitMinMinutes: 10,
      estimatedWaitMaxMinutes: 15,
      waitAcknowledgmentThresholdMinutes: 20,
      requiresWaitAcknowledgment: true,
    });
    expect(buildPublicOrderSessionResponse({
      orderSessionToken: "session-token",
      expiresAt: "2026-08-13T04:10:00.000Z",
      orderingMode: "PREORDER",
      capacity: { quote_min_minutes: 10, quote_max_minutes: 15 },
      fallbackWaitMinutes: 30,
    })).toMatchObject({
      estimatedWaitMinutes: 0,
      estimatedWaitMinMinutes: 0,
      estimatedWaitMaxMinutes: 0,
      waitAcknowledgmentThresholdMinutes: null,
      requiresWaitAcknowledgment: false,
    });
    expect(buildPublicOrderResumeResponse("DELIVERY", "tracking-token", "CONFIRMED"))
      .toEqual({
        orderingMode: "DELIVERY",
        resumeOrder: { trackingToken: "tracking-token", orderStatus: "CONFIRMED" },
      });
  });
});
