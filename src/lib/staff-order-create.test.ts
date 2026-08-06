import { describe, expect, it } from "vitest";
import {
  prepareTrustedStaffOrderItem,
  staffOrderExceedsLimits,
  type TrustedStaffOrderAssignment,
} from "./staff-order-create";

const organizationId = "10000000-0000-4000-8000-000000000001";
const stallId = "20000000-0000-4000-8000-000000000001";
const bundleProductId = "30000000-0000-4000-8000-000000000001";
const choiceGroupId = "40000000-0000-4000-8000-000000000001";
const choiceId = "50000000-0000-4000-8000-000000000001";
const noteGroupId = "60000000-0000-4000-8000-000000000001";
const noteOptionId = "70000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-02T10:00:00.000Z");

function bundleAssignment(): TrustedStaffOrderAssignment {
  return {
    productId: bundleProductId,
    priceOverride: 120,
    product: {
      organizationId,
      name: "招牌套餐",
      defaultPrice: 100,
      kind: "BUNDLE",
      isOrderDiscountEligible: true,
      bundleChoiceGroups: [{
        id: choiceGroupId,
        organizationId,
        bundleProductId,
        name: "主餐",
        minSelections: 1,
        maxSelections: 1,
        choices: [{
          id: choiceId,
          organizationId,
          choiceGroupId,
          quantity: 2,
          priceDelta: 25,
          isEnabled: true,
          componentProduct: {
            organizationId,
            name: "河粉",
            kind: "SINGLE",
            isActive: true,
            category: { isActive: true },
            stallProducts: [{
              organizationId,
              stallId,
              isEnabled: true,
              isSoldOut: false,
              availableFrom: null,
              availableUntil: null,
            }],
          },
        }],
      }],
      noteGroupAssignments: [{
        noteGroup: {
          id: noteGroupId,
          name: "辣度",
          minSelections: 0,
          maxSelections: 1,
          options: [{
            id: noteOptionId,
            name: "加辣",
            priceDelta: 10,
            sortOrder: 1,
          }],
        },
      }],
    },
  };
}

function requestedItem(bundleChoiceIds = [choiceId]) {
  return {
    productId: bundleProductId,
    quantity: 2,
    note: "",
    noteOptionIds: [noteOptionId],
    bundleChoiceIds,
  };
}

describe("店員套餐伺服器定價", () => {
  it("使用可信任的套餐價差並建立 KDS 共用註記快照", () => {
    const item = prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: bundleAssignment(),
      requested: requestedItem(),
    });

    expect(item.baseUnitPrice).toBe(120);
    expect(item.unitPrice).toBe(155);
    expect(item.isOrderDiscountEligible).toBe(true);
    expect(item.noteOptions).toEqual([
      {
        noteGroupId: null,
        noteOptionId: null,
        groupName: "套餐 · 主餐",
        optionName: "河粉 × 2",
        priceDelta: 25,
        sortOrder: 0,
      },
      {
        noteGroupId,
        noteOptionId,
        groupName: "辣度",
        optionName: "加辣",
        priceDelta: 10,
        sortOrder: 100_001,
      },
    ]);
  });

  it("拒絕缺少必選、未知或重複的套餐選項", () => {
    expect(() => prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: bundleAssignment(),
      requested: requestedItem([]),
    })).toThrowError("INVALID_PRODUCT_NOTES");
    expect(() => prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: bundleAssignment(),
      requested: requestedItem(["80000000-0000-4000-8000-000000000001"]),
    })).toThrowError("INVALID_PRODUCT_NOTES");
    expect(() => prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: bundleAssignment(),
      requested: requestedItem([choiceId, choiceId]),
    })).toThrowError("INVALID_PRODUCT_NOTES");
  });

  it("拒絕售罄元件、跨攤位元件與跨組織套餐", () => {
    const soldOut = bundleAssignment();
    soldOut.product.bundleChoiceGroups[0]!.choices[0]!.componentProduct.stallProducts[0]!.isSoldOut = true;
    expect(() => prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: soldOut,
      requested: requestedItem(),
    })).toThrowError("PRODUCT_UNAVAILABLE");

    const wrongStall = bundleAssignment();
    wrongStall.product.bundleChoiceGroups[0]!.choices[0]!.componentProduct.stallProducts[0]!.stallId = "20000000-0000-4000-8000-000000000002";
    expect(() => prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: wrongStall,
      requested: requestedItem(),
    })).toThrowError("PRODUCT_UNAVAILABLE");

    const wrongOrganization = bundleAssignment();
    wrongOrganization.product.organizationId = "10000000-0000-4000-8000-000000000002";
    expect(() => prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: wrongOrganization,
      requested: requestedItem(),
    })).toThrowError("PRODUCT_UNAVAILABLE");
  });

  it("單品禁止攜帶套餐選項", () => {
    const single = bundleAssignment();
    single.product.kind = "SINGLE";
    single.product.bundleChoiceGroups = [];
    expect(() => prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: single,
      requested: requestedItem(),
    })).toThrowError("INVALID_PRODUCT_NOTES");
  });

  it("allows an optional bundle group when every choice is temporarily unavailable", () => {
    const optional = bundleAssignment();
    optional.product.bundleChoiceGroups[0]!.minSelections = 0;
    optional.product.bundleChoiceGroups[0]!.choices[0]!.componentProduct.stallProducts[0]!.isSoldOut = true;

    const item = prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: optional,
      requested: requestedItem([]),
    });

    expect(item.unitPrice).toBe(130);
    expect(item.noteOptions).toHaveLength(1);
    expect(item.noteOptions[0]?.noteGroupId).toBe(noteGroupId);
  });

  it("uses the parent bundle product as the discount eligibility source", () => {
    const assignment = bundleAssignment();
    assignment.product.isOrderDiscountEligible = false;

    const item = prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment,
      requested: requestedItem(),
    });

    expect(item.isOrderDiscountEligible).toBe(false);
    expect(item.unitPrice).toBe(155);
  });
});

describe("店員購物車分列限制", () => {
  const limits = {
    maxItemQuantity: 5,
    maxUniqueProducts: 1,
    maxTotalQuantity: 10,
    maxNoteLength: 100,
  };

  function line(productId: string, quantity: number, noteOptionIds: string[]) {
    return { productId, quantity, note: "", noteOptionIds, bundleChoiceIds: [] };
  }

  it("同商品的不同註記列只占一個商品額度", () => {
    expect(staffOrderExceedsLimits({
      customerNote: "",
      items: [
        line(bundleProductId, 2, [noteOptionId]),
        line(bundleProductId, 2, []),
      ],
    }, limits)).toBe(false);
  });

  it("同商品各列數量合計仍受單品上限限制", () => {
    expect(staffOrderExceedsLimits({
      customerNote: "",
      items: [
        line(bundleProductId, 3, [noteOptionId]),
        line(bundleProductId, 3, []),
      ],
    }, limits)).toBe(true);
  });

  it("不同商品仍受不同商品數上限限制", () => {
    expect(staffOrderExceedsLimits({
      customerNote: "",
      items: [
        line(bundleProductId, 1, []),
        line(choiceId, 1, []),
      ],
    }, limits)).toBe(true);
  });
});
