import { describe, expect, it } from "vitest";
import { getContextualOrderStatusLabel, serializeStaffOrder } from "@/lib/orders";

describe("serializeStaffOrder legacy fulfillment compatibility", () => {
  it("shows a scheduled-only QR takeout upgrade fixture as confirmed", () => {
    const scheduledPickupAt = new Date("2026-08-07T04:30:00.000Z");
    const order = {
      id: "33333333-3333-4333-8333-333333333333",
      orderNo: "A003",
      source: "QR_MENU",
      isTest: false,
      customerName: "Legacy customer",
      customerPhone: null,
      deliveryAddress: null,
      tableLabel: null,
      diningTableId: null,
      fulfillmentType: "TAKEOUT",
      note: null,
      status: "CONFIRMED",
      paymentStatus: "UNPAID",
      subtotal: 100,
      discountAmount: 0,
      discountLabel: null,
      total: 100,
      pickupCodeLength: 3,
      pickupVerifiedAt: null,
      pickupVerificationMethod: null,
      confirmationExpiresAt: new Date("2026-08-06T04:05:00.000Z"),
      quotedWaitMinutes: 15,
      quotedReadyAt: new Date("2026-08-06T04:15:00.000Z"),
      scheduledPickupAt,
      requestedFulfillmentAt: null,
      committedFulfillmentAt: null,
      pendingFulfillmentAt: null,
      fulfillmentTimeState: "NOT_REQUESTED",
      fulfillmentTimeVersion: 0,
      fulfillmentTimeResponseExpiresAt: null,
      fulfillmentTimeChangeReason: null,
      createdAt: new Date("2026-08-06T04:00:00.000Z"),
      printJobs: [],
      items: [],
    } as unknown as Parameters<typeof serializeStaffOrder>[0];

    expect(serializeStaffOrder(order)).toMatchObject({
      scheduledPickupAt: scheduledPickupAt.toISOString(),
      requestedFulfillmentAt: scheduledPickupAt.toISOString(),
      committedFulfillmentAt: scheduledPickupAt.toISOString(),
      fulfillmentTimeState: "CONFIRMED",
      fulfillmentTimeVersion: 0,
      primaryPrintStatus: null,
    });
  });
});

describe("getContextualOrderStatusLabel", () => {
  it.each([
    ["staff unpaid", { source: "STAFF_POS", paymentStatus: "UNPAID", fulfillmentType: "TAKEOUT" }, "待結帳"],
    ["dine in", { source: "STAFF_POS", paymentStatus: "PAID", fulfillmentType: "DINE_IN" }, "待出餐"],
    ["unpaid dine in", { source: "STAFF_POS", paymentStatus: "UNPAID", fulfillmentType: "DINE_IN" }, "待出餐"],
    ["paid delivery", { source: "STAFF_POS", paymentStatus: "PAID", fulfillmentType: "DELIVERY" }, "待交付外送"],
    ["paid takeout", { source: "STAFF_POS", paymentStatus: "PAID", fulfillmentType: "TAKEOUT" }, "待取餐"],
    ["QR pickup semantics", { source: "QR_MENU", paymentStatus: "PAID", fulfillmentType: "DELIVERY" }, "可取餐"],
  ])("labels READY in %s context", (_label, order, expected) => {
    expect(getContextualOrderStatusLabel({ status: "READY", ...order } as never)).toBe(expected);
  });

  it("keeps existing labels outside READY", () => {
    expect(getContextualOrderStatusLabel({
      status: "PREPARING",
      source: "STAFF_POS",
      paymentStatus: "UNPAID",
      fulfillmentType: "TAKEOUT",
    })).toBe("製作中");
  });
});
