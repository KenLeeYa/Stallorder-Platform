import { describe, expect, it } from "vitest";
import { updateStaffOrderItemsSchema } from "@/lib/staff-order-edit-contract";
import { getStaffOrderEditFailure } from "@/lib/staff-order-edit";

const itemId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

function editableOrder() {
  return {
    source: "STAFF_POS",
    fulfillmentType: "TAKEOUT",
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    payment: null,
    discountAmount: 0,
    discountOptionId: null,
    printJobs: [{ status: "PENDING" }],
    items: [{
      status: "PENDING",
      productId,
      productionTask: { status: "PENDING" },
      noteOptions: [{ noteOptionId: itemId }],
    }],
  };
}

describe("staff order item edit boundary", () => {
  it("allows only a locked-down unpaid staff order before production starts", () => {
    expect(getStaffOrderEditFailure(editableOrder())).toBeNull();
  });

  it.each([
    ["dine-in QR source", { source: "QR_MENU", fulfillmentType: "DINE_IN" }, "NOT_EDITABLE_SOURCE"],
    ["paid order", { paymentStatus: "PAID" }, "PAYMENT_ALREADY_RECORDED"],
    ["non-confirmed order", { status: "PREPARING" }, "ORDER_ALREADY_STARTED"],
    ["started item", { items: [{ ...editableOrder().items[0], status: "PREPARING" }] }, "ORDER_ALREADY_STARTED"],
    ["started KDS task", { items: [{ ...editableOrder().items[0], productionTask: { status: "PREPARING" } }] }, "ORDER_ALREADY_STARTED"],
    ["claimed print job", { printJobs: [{ status: "PRINTING" }] }, "PRINT_ALREADY_STARTED"],
    ["legacy bundle snapshot", { items: [{ ...editableOrder().items[0], noteOptions: [{ noteOptionId: null }] }] }, "UNSUPPORTED_EXISTING_CONFIGURATION"],
  ])("rejects %s", (_label, override, expected) => {
    expect(getStaffOrderEditFailure({ ...editableOrder(), ...override })).toBe(expected);
  });

  it.each(["WAITING_CONFIRMATION", "CONFIRMED"])(
    "allows an unpaid public takeout order in %s before production or printing starts",
    (status) => {
      expect(getStaffOrderEditFailure({
        ...editableOrder(),
        source: "QR_MENU",
        fulfillmentType: "TAKEOUT",
        status,
        items: [{ ...editableOrder().items[0], productionTask: null }],
      })).toBeNull();
    },
  );
});

describe("updateStaffOrderItemsSchema", () => {
  it("accepts an explicit customer notice for a sold-out public-order adjustment", () => {
    expect(updateStaffOrderItemsSchema.safeParse({
      items: [{ kind: "EXISTING", itemId, quantity: 1 }],
      publicAmendment: {
        reason: "SOLD_OUT_REMOVE",
        customerMessage: "香酥雞已售完，已移除並重新計算金額。",
      },
    }).success).toBe(true);
  });

  it("rejects an empty public-order customer notice", () => {
    expect(updateStaffOrderItemsSchema.safeParse({
      items: [{ kind: "EXISTING", itemId, quantity: 1 }],
      publicAmendment: {
        reason: "SOLD_OUT_REMOVE",
        customerMessage: " ",
      },
    }).success).toBe(false);
  });
  it("accepts quantity changes, removals by omission, and trusted new product requests", () => {
    expect(updateStaffOrderItemsSchema.safeParse({
      items: [
        { kind: "EXISTING", itemId, quantity: 2 },
        { kind: "NEW", productId, quantity: 1 },
      ],
    }).success).toBe(true);
  });

  it("rejects duplicate existing item references", () => {
    expect(updateStaffOrderItemsSchema.safeParse({
      items: [
        { kind: "EXISTING", itemId, quantity: 1 },
        { kind: "EXISTING", itemId, quantity: 2 },
      ],
    }).success).toBe(false);
  });
});
