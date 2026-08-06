import { describe, expect, it } from "vitest";
import { createStaffOrderSchema } from "./staff-order-contract";

const productId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const bundleChoiceId = "44444444-4444-4444-8444-444444444444";

function baseOrder() {
  return {
    idempotencyKey: crypto.randomUUID(),
    customerName: "現場顧客",
    customerNote: "",
    paymentTiming: "PAY_LATER",
    items: [{ productId, quantity: 1, note: "", noteOptionIds: [] }],
  } as const;
}

describe("店員代客點餐契約", () => {
  it("接受外帶、內用與外送訂單", () => {
    expect(createStaffOrderSchema.safeParse({ ...baseOrder(), fulfillmentType: "TAKEOUT" }).success).toBe(true);
    expect(createStaffOrderSchema.safeParse({ ...baseOrder(), fulfillmentType: "DINE_IN", diningTableId: tableId }).success).toBe(true);
    expect(createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "DELIVERY",
      customerPhone: "0912345678",
      deliveryAddress: "台北市信義區測試路 1 號",
    }).success).toBe(true);
  });

  it("外送必須提供有效電話與地址", () => {
    const result = createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "DELIVERY",
      customerPhone: "123",
      deliveryAddress: "",
    });
    expect(result.success).toBe(false);
  });

  it("外帶與外送可指定時間，但內用不可夾帶指定時間", () => {
    const requestedFulfillmentAt = "2026-08-07T12:30:00+08:00";
    expect(createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "TAKEOUT",
      requestedFulfillmentAt,
    }).success).toBe(true);
    expect(createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "DELIVERY",
      customerPhone: "0912345678",
      deliveryAddress: "台北市信義區測試路 1 號",
      requestedFulfillmentAt,
    }).success).toBe(true);
    expect(createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "DINE_IN",
      diningTableId: tableId,
      requestedFulfillmentAt,
    }).success).toBe(false);
  });

  it("立即結帳必須提供付款資料", () => {
    const result = createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "TAKEOUT",
      paymentTiming: "PAY_NOW",
    });
    expect(result.success).toBe(false);
  });

  it("接受同商品不同註記列，但拒絕相同設定與列內重複註記", () => {
    const firstNoteOptionId = "33333333-3333-4333-8333-333333333333";
    const secondNoteOptionId = "33333333-3333-4333-8333-333333333334";
    const differentConfigurations = createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "TAKEOUT",
      items: [
        { productId, quantity: 1, note: "", noteOptionIds: [firstNoteOptionId] },
        { productId, quantity: 1, note: "", noteOptionIds: [secondNoteOptionId] },
      ],
    });
    expect(differentConfigurations.success).toBe(true);

    const duplicateConfiguration = createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "TAKEOUT",
      items: [
        { productId, quantity: 1, note: "", noteOptionIds: [firstNoteOptionId] },
        { productId, quantity: 2, note: "", noteOptionIds: [firstNoteOptionId] },
      ],
    });
    expect(duplicateConfiguration.success).toBe(false);

    const duplicateNote = createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "TAKEOUT",
      items: [{
        productId,
        quantity: 1,
        note: "",
        noteOptionIds: [firstNoteOptionId, firstNoteOptionId],
      }],
    });
    expect(duplicateNote.success).toBe(false);
  });

  it("接受套餐選項並拒絕重複套餐選項", () => {
    const accepted = createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "TAKEOUT",
      items: [{
        productId,
        quantity: 1,
        note: "",
        noteOptionIds: [],
        bundleChoiceIds: [bundleChoiceId],
      }],
    });
    expect(accepted.success).toBe(true);
    if (accepted.success) {
      expect(accepted.data.items[0]?.bundleChoiceIds).toEqual([bundleChoiceId]);
    }

    const duplicate = createStaffOrderSchema.safeParse({
      ...baseOrder(),
      fulfillmentType: "TAKEOUT",
      items: [{
        productId,
        quantity: 1,
        note: "",
        noteOptionIds: [],
        bundleChoiceIds: [bundleChoiceId, bundleChoiceId],
      }],
    });
    expect(duplicate.success).toBe(false);
  });
});
