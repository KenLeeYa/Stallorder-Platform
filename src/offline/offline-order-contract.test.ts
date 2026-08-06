import { describe, expect, it } from "vitest";
import {
  canTransitionOfflineOrder,
  offlineOrderSchema,
  offlinePaymentSchema,
  offlineSyncRequestSchema,
} from "@/offline/offline-order-contract";

const orderId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000001";

function validOrder() {
  return {
    offlineOrderId: orderId,
    deviceId: "30000000-0000-4000-8000-000000000001",
    organizationId: "40000000-0000-4000-8000-000000000001",
    stallId: "50000000-0000-4000-8000-000000000001",
    localSequence: 1,
    localDisplayNumber: "OFF-300000-20260729-1",
    menuSnapshotVersion: 1,
    itemsSnapshot: [{
      localItemId: "60000000-0000-4000-8000-000000000001",
      productId,
      name: "測試商品",
      baseUnitPrice: 100,
      unitPrice: 115,
      quantity: 2,
      note: "",
      noteOptions: [{
        noteGroupId: "70000000-0000-4000-8000-000000000001",
        noteOptionId: "80000000-0000-4000-8000-000000000001",
        groupName: "加料",
        optionName: "加蛋",
        priceDelta: 15,
        sortOrder: 1,
      }],
    }],
    subtotal: 230,
    discountAmount: 0,
    total: 230,
    currency: "TWD",
    paymentMethod: "CASH",
    paymentStatus: "PAID_LOCAL",
    orderStatus: "LOCAL_CONFIRMED",
    customerLabel: "現場顧客",
    customerContact: "",
    note: "",
    createdAtDevice: "2026-07-29T01:00:00.000Z",
    updatedAtDevice: "2026-07-29T01:00:00.000Z",
    idempotencyKey: "90000000-0000-4000-8000-000000000001",
    syncStatus: "PENDING",
    retryCount: 0,
    lastRetryAt: null,
    promotionEpoch: "1",
    protocolVersion: "2",
  };
}

describe("offline order contract", () => {
  it("permits forward-only local state transitions", () => {
    expect(canTransitionOfflineOrder("LOCAL_CONFIRMED", "LOCAL_PREPARING")).toBe(true);
    expect(canTransitionOfflineOrder("LOCAL_PREPARING", "LOCAL_READY")).toBe(true);
    expect(canTransitionOfflineOrder("LOCAL_READY", "LOCAL_COMPLETED")).toBe(true);
    expect(canTransitionOfflineOrder("LOCAL_READY", "LOCAL_PREPARING")).toBe(false);
    expect(canTransitionOfflineOrder("LOCAL_COMPLETED", "LOCAL_CANCELLED")).toBe(false);
  });

  it("rejects client-tampered totals and duplicate configurations while allowing product variants", () => {
    expect(offlineOrderSchema.safeParse({ ...validOrder(), total: 1 }).success).toBe(false);
    const order = validOrder();
    const variant = {
      ...order.itemsSnapshot[0],
      localItemId: "60000000-0000-4000-8000-000000000002",
      noteOptions: [{
        ...order.itemsSnapshot[0].noteOptions[0],
        noteOptionId: "80000000-0000-4000-8000-000000000002",
        optionName: "加起司",
      }],
    };
    expect(offlineOrderSchema.safeParse({
      ...order,
      itemsSnapshot: [...order.itemsSnapshot, variant],
      subtotal: 460,
      total: 460,
    }).success).toBe(true);
    expect(offlineOrderSchema.safeParse({
      ...order,
      itemsSnapshot: [...order.itemsSnapshot, {
        ...order.itemsSnapshot[0],
        localItemId: "60000000-0000-4000-8000-000000000002",
      }],
      subtotal: 460,
      total: 460,
    }).success).toBe(false);
  });

  it("keeps manual electronic payment pending reconciliation", () => {
    const payment = {
      localPaymentId: "a0000000-0000-4000-8000-000000000001",
      offlineOrderId: orderId,
      paymentOptionId: null,
      method: "MANUAL_LINE_PAY",
      status: "PENDING_RECONCILIATION",
      amount: 230,
      cashReceived: null,
      changeAmount: null,
      methodLabel: "LINE Pay 人工確認",
      cashShiftId: null,
      recordedAtDevice: "2026-07-29T01:00:00.000Z",
    };
    expect(offlinePaymentSchema.safeParse(payment).success).toBe(true);
    expect(offlinePaymentSchema.safeParse({ ...payment, status: "PAID_LOCAL" }).success).toBe(false);
  });

  it("bounds synchronization batches and rejects unknown fields", () => {
    const record = {
      recordType: "ORDER",
      queueId: "b0000000-0000-4000-8000-000000000001",
      order: validOrder(),
      events: [{
        eventId: "c0000000-0000-4000-8000-000000000001",
        offlineOrderId: orderId,
        previousState: null,
        nextState: "LOCAL_CONFIRMED",
        reason: null,
        occurredAtDevice: "2026-07-29T01:00:00.000Z",
      }],
      payment: {
        localPaymentId: "d0000000-0000-4000-8000-000000000001",
        offlineOrderId: orderId,
        paymentOptionId: null,
        method: "CASH",
        status: "PAID_LOCAL",
        amount: 230,
        cashReceived: 500,
        changeAmount: 270,
        methodLabel: "現金",
        cashShiftId: "e0000000-0000-4000-8000-000000000001",
        recordedAtDevice: "2026-07-29T01:00:00.000Z",
      },
      printJobs: [],
    };
    const request = {
      installationId: "f0000000-0000-4000-8000-000000000001",
      permitToken: "x".repeat(64),
      appProtocolVersion: "2",
      clientSentAt: "2026-07-29T01:00:01.000Z",
      records: [record],
    };
    expect(offlineSyncRequestSchema.safeParse(request).success).toBe(true);
    expect(offlineSyncRequestSchema.safeParse({ ...request, unexpected: true }).success).toBe(false);
    expect(offlineSyncRequestSchema.safeParse({
      ...request,
      records: Array.from({ length: 51 }, () => record),
    }).success).toBe(false);
  });

  it("accepts an unpaid order without a payment record", () => {
    const unpaidOrder = {
      ...validOrder(),
      paymentMethod: null,
      paymentStatus: "UNPAID",
    };
    const request = {
      installationId: "f0000000-0000-4000-8000-000000000001",
      permitToken: "x".repeat(64),
      appProtocolVersion: "2",
      clientSentAt: "2026-07-29T01:00:01.000Z",
      records: [{
        recordType: "ORDER",
        queueId: "b0000000-0000-4000-8000-000000000001",
        order: unpaidOrder,
        events: [{
          eventId: "c0000000-0000-4000-8000-000000000001",
          offlineOrderId: orderId,
          previousState: null,
          nextState: "LOCAL_CONFIRMED",
          reason: null,
          occurredAtDevice: "2026-07-29T01:00:00.000Z",
        }],
        payment: null,
        printJobs: [],
      }],
    };

    expect(offlineSyncRequestSchema.safeParse(request).success).toBe(true);
  });
});
