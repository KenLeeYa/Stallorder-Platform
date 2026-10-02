import { describe, expect, it } from "vitest";
import {
  prepareStaffOrderItems,
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
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
      organizationId,
      name: "招牌套餐",
      defaultPrice: 100,
      kind: "BUNDLE",
      isOrderDiscountEligible: true,
      bundleChoiceGroups: [{
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
        id: choiceGroupId,
        organizationId,
        bundleProductId,
        name: "主餐",
        minSelections: 1,
        maxSelections: 1,
        choices: [{
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
          id: choiceId,
          organizationId,
          choiceGroupId,
          quantity: 2,
          priceDelta: 25,
          isEnabled: true,
          componentProduct: {
            createdAt: new Date("2026-07-01T00:00:00Z"),
            updatedAt: new Date("2026-07-01T00:00:00Z"),
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
  it("按履約時間拒絕已停止供應的套餐元件", () => {
    const assignment = bundleAssignment();
    assignment.product.bundleChoiceGroups[0]!.choices[0]!.componentProduct.stallProducts[0]!.availableUntil = new Date("2026-08-03T10:00:00Z");
    expect(() => prepareTrustedStaffOrderItem({ organizationId, stallId, now, assignment, requested: requestedItem() })).not.toThrow();
    expect(() => prepareTrustedStaffOrderItem({ organizationId, stallId, now: new Date("2026-08-04T10:00:00Z"), assignment, requested: requestedItem() })).toThrow("PRODUCT_UNAVAILABLE");
  });
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

  it("允許只對線上標記售完的元件", () => {
    const soldOut = bundleAssignment();
    soldOut.product.bundleChoiceGroups[0]!.choices[0]!.componentProduct.stallProducts[0]!.isSoldOut = true;
    const item = prepareTrustedStaffOrderItem({
      organizationId,
      stallId,
      now,
      assignment: soldOut,
      requested: requestedItem(),
    });

    expect(item.unitPrice).toBe(155);
  });

  it("顧客修改拒絕停售套餐元件，店員仍可受權照點", () => {
    const assignment = bundleAssignment();
    assignment.product.bundleChoiceGroups[0]!.choices[0]!.componentProduct.stallProducts[0]!.isSoldOut = true;
    const input = { organizationId, stallId, now, assignment, requested: requestedItem() };
    expect(() => prepareTrustedStaffOrderItem(input)).not.toThrow();
    expect(() => prepareTrustedStaffOrderItem({ ...input, rejectSoldOutBundleComponents: true })).toThrow("PRODUCT_UNAVAILABLE");
    assignment.product.bundleChoiceGroups[0]!.choices[0]!.componentProduct.stallProducts[0]!.soldOutUntil = new Date("2020-01-01T00:00:00Z");
    expect(() => prepareTrustedStaffOrderItem({ ...input, rejectSoldOutBundleComponents: true })).not.toThrow();
  });

  it("真實prepare保留同配置停售套餐減量，拒絕增量並偵測替換配置", async () => {
    const assignment = bundleAssignment();
    const component = assignment.product.bundleChoiceGroups[0]!.choices[0]!.componentProduct;
    component.stallProducts[0]!.isSoldOut = true;
    const settings = { unconfirmedOrderTimeoutSeconds: 300, maxItemQuantity: 10, maxTotalQuantity: 20, maxUniqueProducts: 10, maxNoteLength: 1000 };
    const client = { stallOrderingSettings: { findUnique: async () => settings }, stallProduct: { findMany: async () => [assignment] } };
    const previous = [{ productId: bundleProductId, quantity: 2, createdAt: now, noteOptions: [{ noteOptionId: null, groupName: "套餐 · 主餐", optionName: "河粉 × 2" }] }];
    const request = { customerNote: "", items: [{ ...requestedItem(), quantity: 1 }] };
    await expect(prepareStaffOrderItems(client as never, organizationId, stallId, request, now, true, previous)).resolves.toMatchObject({ addsBundleFulfillment: false });
    await expect(prepareStaffOrderItems(client as never, organizationId, stallId, { ...request, items: [{ ...requestedItem(), quantity: 3 }] }, now, true, previous)).rejects.toThrow("PRODUCT_UNAVAILABLE");
    component.stallProducts[0]!.isSoldOut = false;
    const alternative = { ...assignment.product.bundleChoiceGroups[0]!.choices[0]!, id: "50000000-0000-4000-8000-000000000002", componentProduct: { ...component, name: "炒飯" } };
    assignment.product.bundleChoiceGroups[0]!.choices.push(alternative);
    await expect(prepareStaffOrderItems(client as never, organizationId, stallId, { ...request, items: [{ ...requestedItem([alternative.id]), quantity: 1 }] }, now, true, previous)).resolves.toMatchObject({ addsBundleFulfillment: true });
    alternative.componentProduct.name = "河粉";
    component.stallProducts[0]!.isSoldOut = true;
    await expect(prepareStaffOrderItems(client as never, organizationId, stallId, request, now, true, previous)).rejects.toThrow("PRODUCT_UNAVAILABLE");
  });

  it.each(["choice recreated", "choice reassigned", "component replaced", "group recreated", "timestamp missing"])("does not retain historical names after %s", async (change) => {
    const assignment = bundleAssignment();
    const group = assignment.product.bundleChoiceGroups[0]!;
    const choice = group.choices[0]!;
    choice.componentProduct.stallProducts[0]!.isSoldOut = true;
    const later = new Date("2026-08-03T00:00:00Z");
    if (change === "choice recreated") choice.createdAt = later;
    if (change === "choice reassigned") choice.updatedAt = later;
    if (change === "component replaced") choice.componentProduct.createdAt = later;
    if (change === "group recreated") group.createdAt = later;
    if (change === "timestamp missing") choice.updatedAt = undefined;
    const settings = { unconfirmedOrderTimeoutSeconds: 300, maxItemQuantity: 10, maxTotalQuantity: 20, maxUniqueProducts: 10, maxNoteLength: 1000 };
    const client = { stallOrderingSettings: { findUnique: async () => settings }, stallProduct: { findMany: async () => [assignment] } };
    const previous = [{ productId: bundleProductId, quantity: 2, createdAt: now, noteOptions: [{ noteOptionId: null, groupName: "套餐 · 主餐", optionName: "河粉 × 2" }] }];
    const request = { customerNote: "", items: [{ ...requestedItem(), quantity: 1 }] };
    await expect(prepareStaffOrderItems(client as never, organizationId, stallId, request, now, true, previous)).rejects.toThrow("PRODUCT_UNAVAILABLE");
    await expect(prepareStaffOrderItems(client as never, organizationId, stallId, request, now)).resolves.toMatchObject({ addsBundleFulfillment: false });
  });

  it("拒絕跨攤位元件與跨組織套餐", () => {
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
