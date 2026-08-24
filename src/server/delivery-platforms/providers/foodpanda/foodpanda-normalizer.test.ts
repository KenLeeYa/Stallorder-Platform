import { describe, expect, it } from "vitest";
import { normalizeFoodpandaOrder } from "./foodpanda-normalizer";

const officialShape = {
  accepted_for: "2026-08-21T10:15:00.000Z",
  promised_for: "2026-08-21T10:30:00.000Z",
  comment: "不要餐具",
  external_order_id: "order-78107",
  isPreorder: false,
  order_code: "wxfr-2440-rtbs",
  order_id: "9d4a63b5-3e07-4440-96af-aa04797da3a0",
  order_type: "DELIVERY",
  client: { chain_id: "chain-1", country_code: "tw", store_id: "vendor-1" },
  customer: { first_name: "王**", last_name: "*", phone_number: "09******12" },
  items: [{
    _id: "item-instance-1",
    instructions: "少冰",
    name: "測試餐點",
    pricing: {
      pricing_type: "UNIT",
      quantity: 2,
      total_price: 240,
      unit_price: 120,
      weight: 0,
      weighted_pieces: 0,
    },
    sku: "sku-1",
    promotion: [{
      discount_amount: 20,
      sponsorships: [{ sponsor: "VENDOR", amount: 5 }, { sponsor: "PLATFORM", amount: 15 }],
    }],
  }],
  payment: {
    collect_at_pickup: 0,
    delivery_fee: 30,
    discount: -20,
    order_total: 250,
    service_fee: 0,
    sub_total: 240,
    total_taxes: 0,
    type: "PAID",
  },
  status: "RECEIVED",
  sys: {
    created_at: "2026-08-21T10:00:36.947Z",
    updated_at: "2026-08-21T10:05:36.947Z",
  },
  transport_type: "LOGISTICS_DELIVERY",
  promotion_status: "AVAILABLE",
} as const;

describe("foodpanda order normalizer", () => {
  it("maps the documented Partner API shape into the provider-neutral order", () => {
    const order = normalizeFoodpandaOrder(officialShape);
    expect(order).toMatchObject({
      provider: "FOODPANDA",
      externalOrderId: officialShape.order_id,
      externalOrderNumber: officialShape.order_code,
      externalStoreId: "vendor-1",
      currency: "TWD",
      customerDisplayName: "王** *",
      customerPhoneMasked: "***12",
      pricing: {
        subtotal: 240,
        platformDiscount: 15,
        merchantDiscount: 5,
        deliveryFee: 30,
        total: 250,
        merchantReceivable: 235,
      },
      payment: { status: "PAID", merchantCollectedCash: false },
      fulfillment: { type: "DELIVERY" },
    });
    expect(order.items[0]).toMatchObject({
      externalItemId: "item-instance-1",
      externalProductId: "sku-1",
      quantity: 2,
      unitPrice: 120,
      totalPrice: 240,
      notes: "少冰",
    });
  });

  it("rejects fractional TWD and missing critical identifiers", () => {
    expect(() => normalizeFoodpandaOrder({
      ...officialShape,
      payment: { ...officialShape.payment, order_total: 250.5 },
    })).toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_ERROR" }));
    expect(() => normalizeFoodpandaOrder({ ...officialShape, order_id: "" }))
      .toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_ERROR" }));
  });

  it("allows new optional provider fields without weakening required-field validation", () => {
    expect(normalizeFoodpandaOrder({ ...officialShape, future_optional_field: { value: true } }))
      .toMatchObject({ externalOrderId: officialShape.order_id });
  });

  it("masks provider phone numbers before returning the durable field", () => {
    expect(normalizeFoodpandaOrder({
      ...officialShape,
      customer: { ...officialShape.customer, phone_number: "+886 912-345-678" },
    }).customerPhoneMasked).toBe("***78");

    expect(normalizeFoodpandaOrder({
      ...officialShape,
      customer: { ...officialShape.customer, phone_number: "private" },
    }).customerPhoneMasked).toBeNull();
  });
});
