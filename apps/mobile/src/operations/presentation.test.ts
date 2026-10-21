import { describe, expect, it } from "vitest";
import {
  deduplicateAuthoritativeOrders,
  mobileFulfillmentTypeLabels,
  mobileOrderItemStatusLabels,
  mobilePaymentStatusLabels,
} from "./presentation";

function order(id: string, updatedAt: string, status: "READY" | "COMPLETED") {
  return {
    id,
    orderNo: id,
    status,
    paymentStatus: "PAID" as const,
    fulfillmentType: "TAKEOUT" as const,
    customerName: "測試顧客",
    tableLabel: null,
    total: 100,
    itemCount: 1,
    isTest: false,
    createdAt: "2026-08-25T08:00:00.000Z",
    updatedAt,
  };
}

describe("authoritative mobile order presentation", () => {
  it("keeps only the newest duplicate order revision", () => {
    const result = deduplicateAuthoritativeOrders([
      order("11111111-1111-4111-8111-111111111111", "2026-08-25T09:00:00.000Z", "READY"),
      order("11111111-1111-4111-8111-111111111111", "2026-08-25T09:01:00.000Z", "COMPLETED"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("COMPLETED");
  });

  it("uses localized labels for read-only order fields", () => {
    expect(mobilePaymentStatusLabels.PENDING_RECONCILIATION).toBe("待對帳");
    expect(mobileFulfillmentTypeLabels.DINE_IN).toBe("內用");
    expect(mobileOrderItemStatusLabels.PREPARING).toBe("製作中");
  });
});
