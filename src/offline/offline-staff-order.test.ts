import { describe, expect, it } from "vitest";
import { offlineOrderSchema } from "@/offline/offline-order-contract";
import { offlineOrderToStaffOrder } from "@/offline/offline-staff-order";

const order = offlineOrderSchema.parse({
  offlineOrderId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  stallId: "44444444-4444-4444-8444-444444444444",
  localSequence: 1,
  localDisplayNumber: "OFF-A1B2C3-20260729-1",
  menuSnapshotVersion: 2,
  itemsSnapshot: [{
    localItemId: "55555555-5555-4555-8555-555555555555",
    productId: "66666666-6666-4666-8666-666666666666",
    name: "離線雞排",
    baseUnitPrice: 80,
    unitPrice: 95,
    quantity: 2,
    note: "",
    noteOptions: [{
      noteGroupId: "77777777-7777-4777-8777-777777777777",
      noteOptionId: "88888888-8888-4888-8888-888888888888",
      groupName: "加料",
      optionName: "加蛋",
      priceDelta: 15,
      sortOrder: 0,
    }],
  }],
  subtotal: 190,
  discountAmount: 0,
  total: 190,
  currency: "TWD",
  paymentMethod: "MANUAL_LINE_PAY",
  paymentStatus: "PENDING_RECONCILIATION",
  orderStatus: "LOCAL_READY",
  customerLabel: "測試顧客",
  customerContact: "0912345678",
  note: "",
  createdAtDevice: "2026-07-29T10:00:00.000Z",
  updatedAtDevice: "2026-07-29T10:05:00.000Z",
  idempotencyKey: "99999999-9999-4999-8999-999999999999",
  syncStatus: "PENDING",
  retryCount: 0,
  lastRetryAt: null,
  promotionEpoch: "1",
  protocolVersion: "2",
});

describe("offline order Staff board projection", () => {
  it("shows local identity, ready item state and pending reconciliation", () => {
    const projected = offlineOrderToStaffOrder(order);

    expect(projected.orderNo).toBe("OFF-A1B2C3-20260729-1");
    expect(projected.source).toBe("OFFLINE_POS");
    expect(projected.status).toBe("READY");
    expect(projected.paymentStatus).toBe("PENDING_RECONCILIATION");
    expect(projected.items[0]).toMatchObject({
      status: "READY",
      unitPrice: 95,
      quantity: 2,
    });
  });
});
