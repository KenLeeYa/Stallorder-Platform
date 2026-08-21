import type { StaffOrderDto } from "@/lib/orders";
import { describe, expect, it } from "vitest";
import {
  createStaffOrderCheckoutState,
  getStaffOrderCheckoutModel,
  staffOrderCheckoutReducer,
} from "./staff-order-board-checkout";

const cash = { id: "cash", name: "現金", kind: "CASH" as const };
const card = { id: "card", name: "信用卡", kind: "CUSTOM" as const };
const paymentModules = {
  payment: true,
  discount: true,
  discountApprovalThresholdBps: 9_000,
};

describe("staff order checkout state", () => {
  it("opens with the configured default and resets customer-entered checkout fields", () => {
    const order = staffOrder("order-1");
    let state = createStaffOrderCheckoutState();
    state = staffOrderCheckoutReducer(state, {
      type: "OPEN",
      orders: [order],
      modules: paymentModules,
      paymentOptions: [card, cash],
    });
    state = staffOrderCheckoutReducer(state, {
      type: "SET_CASH_RECEIVED",
      value: "500",
    });
    state = staffOrderCheckoutReducer(state, {
      type: "SELECT_PAYMENT",
      paymentOptionId: "cash",
    });

    expect(state.orders).toEqual([order]);
    expect(state.selectedPaymentOptionId).toBe("cash");
    expect(state.cashReceived).toBe("");

    state = staffOrderCheckoutReducer(state, { type: "CLOSE" });
    expect(state).toEqual(createStaffOrderCheckoutState());
  });

  it("uses cash when payment modules are disabled and reconciles open orders authoritatively", () => {
    const staleOne = staffOrder("order-1", 100);
    const staleTwo = staffOrder("order-2", 200);
    const currentTwo = staffOrder("order-2", 250);
    let state = staffOrderCheckoutReducer(createStaffOrderCheckoutState(), {
      type: "OPEN",
      orders: [staleOne, staleTwo],
      modules: { ...paymentModules, payment: false },
      paymentOptions: [card, cash],
    });

    expect(state.selectedPaymentOptionId).toBe("cash");
    state = staffOrderCheckoutReducer(state, {
      type: "RECONCILE_ORDERS",
      orders: [currentTwo],
    });

    expect(state.orders).toEqual([currentTwo]);
  });
});

describe("staff order checkout model", () => {
  it("derives partial-discount approval, cash change, readiness, and request payload", () => {
    const order = staffOrder("order-1", 150, [
      { unitPrice: 100, quantity: 1, isOrderDiscountEligible: true },
      { unitPrice: 50, quantity: 1, isOrderDiscountEligible: false },
    ]);
    let state = staffOrderCheckoutReducer(createStaffOrderCheckoutState(), {
      type: "OPEN",
      orders: [order],
      modules: paymentModules,
      paymentOptions: [cash],
    });
    state = staffOrderCheckoutReducer(state, {
      type: "SELECT_DISCOUNT",
      discountOptionId: "discount-20",
    });
    state = staffOrderCheckoutReducer(state, {
      type: "SET_CASH_RECEIVED",
      value: "200",
    });
    state = staffOrderCheckoutReducer(state, {
      type: "SET_DISCOUNT_APPROVAL_REASON",
      value: "  現場補償  ",
    });

    const blocked = getStaffOrderCheckoutModel({
      state,
      modules: paymentModules,
      paymentOptions: [cash],
      discountOptions: [{ id: "discount-20", name: "八折", rateBps: 8_000 }],
      role: "STAFF",
    });

    expect(blocked.discountEligibleSubtotal).toBe(100);
    expect(blocked.preview).toMatchObject({ subtotal: 150, total: 130, discountAmount: 20 });
    expect(blocked.change).toBe(70);
    expect(blocked.needsApproval).toBe(true);
    expect(blocked.ready).toBe(false);

    state = staffOrderCheckoutReducer(state, {
      type: "SET_MANAGER_EMAIL",
      value: " manager@example.com ",
    });
    state = staffOrderCheckoutReducer(state, {
      type: "SET_MANAGER_PASSWORD",
      value: "secret",
    });
    const ready = getStaffOrderCheckoutModel({
      state,
      modules: paymentModules,
      paymentOptions: [cash],
      discountOptions: [{ id: "discount-20", name: "八折", rateBps: 8_000 }],
      role: "STAFF",
    });

    expect(ready.ready).toBe(true);
    expect(ready.request).toEqual({
      paymentOptionId: "cash",
      discountOptionId: "discount-20",
      cashReceived: 200,
      discountApprovalReason: "現場補償",
      managerEmail: "manager@example.com",
      managerPassword: "secret",
    });
  });

  it("does not require manager credentials when the operator can approve", () => {
    const order = staffOrder("order-1", 100);
    let state = staffOrderCheckoutReducer(createStaffOrderCheckoutState(), {
      type: "OPEN",
      orders: [order],
      modules: paymentModules,
      paymentOptions: [cash],
    });
    state = staffOrderCheckoutReducer(state, {
      type: "SELECT_DISCOUNT",
      discountOptionId: "discount-20",
    });
    state = staffOrderCheckoutReducer(state, {
      type: "SET_DISCOUNT_APPROVAL_REASON",
      value: "manager override",
    });

    expect(getStaffOrderCheckoutModel({
      state,
      modules: paymentModules,
      paymentOptions: [cash],
      discountOptions: [{ id: "discount-20", name: "八折", rateBps: 8_000 }],
      role: "STALL_MANAGER",
    })).toMatchObject({
      operatorCanApproveDiscount: true,
      ready: true,
    });
  });
});

function staffOrder(
  id: string,
  subtotal = 100,
  items: Array<{
    unitPrice: number;
    quantity: number;
    isOrderDiscountEligible: boolean;
  }> = [{ unitPrice: subtotal, quantity: 1, isOrderDiscountEligible: true }],
) {
  return {
    id,
    subtotal,
    total: subtotal,
    discountLabel: null,
    items,
  } as StaffOrderDto;
}
