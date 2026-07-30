import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { NormalizedExternalOrder } from "./delivery-platform-types";
import {
  parseDeliveryOrderJobInput,
  serializeNormalizedExternalOrder,
} from "./delivery-order-contract";

const order: NormalizedExternalOrder = {
  provider: "MOCK",
  externalOrderId: "mock-order-001",
  externalOrderNumber: "M001",
  externalStoreId: "mock-store-001",
  currency: "TWD",
  placedAt: new Date("2026-07-30T01:02:03.000Z"),
  scheduledPickupAt: new Date("2026-07-30T01:30:00.000Z"),
  customerDisplayName: "合成顧客",
  customerPhoneMasked: "***-***-001",
  customerNote: null,
  items: [{
    externalItemId: "item-001",
    externalProductId: "product-001",
    name: "合成餐點",
    quantity: 1,
    unitPrice: 100,
    totalPrice: 100,
    modifiers: [],
    notes: null,
  }],
  pricing: {
    subtotal: 100,
    platformDiscount: 0,
    merchantDiscount: 0,
    deliveryFee: 20,
    serviceFee: 0,
    tax: 0,
    total: 120,
    merchantReceivable: 100,
  },
  payment: {
    status: "PAID_BY_PLATFORM",
    merchantCollectedCash: false,
  },
  fulfillment: { type: "DELIVERY" },
  providerMetadata: { synthetic: true },
};

describe("delivery order job contract", () => {
  it("round-trips normalized dates without persisting executable values", () => {
    const parsed = parseDeliveryOrderJobInput({
      externalOrderLedgerId: "11111111-1111-4111-8111-111111111111",
      webhookEventId: "22222222-2222-4222-8222-222222222222",
      order: serializeNormalizedExternalOrder(order),
    } as unknown as Prisma.JsonValue);

    expect(parsed.order.placedAt).toEqual(order.placedAt);
    expect(parsed.order.scheduledPickupAt).toEqual(order.scheduledPickupAt);
    expect(parsed.order.providerMetadata).toEqual({ synthetic: true });
  });

  it("rejects unknown credential fields and malformed amounts", () => {
    const persisted = serializeNormalizedExternalOrder(order) as Record<string, unknown>;
    expect(() => parseDeliveryOrderJobInput({
      externalOrderLedgerId: "11111111-1111-4111-8111-111111111111",
      webhookEventId: null,
      order: { ...persisted, accessToken: "must-not-persist" },
    })).toThrow();

    expect(() => parseDeliveryOrderJobInput({
      externalOrderLedgerId: "11111111-1111-4111-8111-111111111111",
      webhookEventId: null,
      order: {
        ...persisted,
        pricing: { ...(persisted.pricing as object), total: -1 },
      },
    })).toThrow();
  });
});
