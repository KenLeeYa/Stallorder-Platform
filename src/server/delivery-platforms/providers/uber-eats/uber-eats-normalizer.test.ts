import { describe, expect, it } from "vitest";
import { normalizeUberEatsOrder } from "./uber-eats-normalizer";

const money = (amount: number) => ({ amount, currency_code: "TWD", formatted_amount: `$${amount}` });

const officialShape = {
  id: "f9f363d1-e1c2-4595-b477-c649845bc953",
  display_id: "BC953",
  current_state: "CREATED",
  store: { id: "c7f1dc2f-fabe-4997-845c-cad26fdcb894", name: "測試店" },
  eater: { first_name: "王", last_name: "先", phone: "+886 912 345 678" },
  cart: {
    special_instructions: "不要餐具",
    items: [{
      id: "Muffin",
      instance_id: "Muffin-Instance",
      title: "Fresh-baked muffin",
      quantity: 1,
      price: { unit_price: money(350), total_price: money(400) },
      selected_modifier_groups: [{
        selected_items: [{
          id: "Chocolate-deluxe",
          instance_id: "Chocolate-deluxe-instance",
          title: "Chocolate deluxe",
          quantity: 1,
          price: { unit_price: money(50), total_price: money(50) },
        }],
      }],
      special_instructions: "少糖",
    }],
  },
  payment: {
    charges: {
      total: money(430),
      sub_total: money(400),
      tax: money(0),
      total_fee: money(30),
      cash_amount_due: money(0),
    },
  },
  placed_at: "2026-08-21T15:16:54+08:00",
  estimated_ready_for_pickup_at: "2026-08-21T15:36:54+08:00",
  type: "DELIVERY_BY_UBER",
  brand: "UBER_EATS",
} as const;

describe("Uber Eats order normalizer", () => {
  it("maps the documented v2 Get Order response and minimizes phone PII", () => {
    const order = normalizeUberEatsOrder(officialShape);
    expect(order).toMatchObject({
      provider: "UBER_EATS",
      externalOrderId: officialShape.id,
      externalOrderNumber: "BC953",
      externalStoreId: officialShape.store.id,
      currency: "TWD",
      customerDisplayName: "王 先",
      customerPhoneMasked: "***78",
      pricing: {
        subtotal: 400,
        serviceFee: 30,
        total: 430,
        merchantReceivable: 430,
      },
      payment: { status: "PAID_BY_PLATFORM", merchantCollectedCash: false },
      fulfillment: { type: "DELIVERY" },
    });
    expect(order.items[0].modifiers[0]).toMatchObject({
      externalModifierId: "Chocolate-deluxe-instance",
      unitPrice: 50,
      totalPrice: 50,
    });
  });

  it("rejects mixed currencies and non-integer provider money", () => {
    expect(() => normalizeUberEatsOrder({
      ...officialShape,
      payment: {
        charges: { ...officialShape.payment.charges, total: { amount: 430, currency_code: "USD" } },
      },
    })).toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_ERROR" }));
    expect(() => normalizeUberEatsOrder({
      ...officialShape,
      payment: {
        charges: { ...officialShape.payment.charges, total: { amount: 430.5, currency_code: "TWD" } },
      },
    })).toThrowError(expect.objectContaining({ code: "PROVIDER_CONTRACT_ERROR" }));
  });
});
