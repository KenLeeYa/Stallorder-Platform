import { describe, expect, it } from "vitest";
import type { StaffOrderDto } from "@/lib/orders";
import {
  filterStaffOrders,
  selectStaffOrderDiningTableGroups,
  selectStaffOrderKitchenGroups,
} from "./staff-order-board-selectors";

describe("StaffOrderBoard selectors", () => {
  it("filters by normalized order number, table label, or customer name", () => {
    const orders = [
      staffOrder({ id: "one", orderNo: "A-101", tableLabel: "一號桌", customerName: "Alice" }),
      staffOrder({ id: "two", orderNo: "B-202", tableLabel: "二號桌", customerName: "王小明" }),
    ];

    expect(filterStaffOrders(orders, "  a-101 ")).toEqual([orders[0]]);
    expect(filterStaffOrders(orders, "二號")).toEqual([orders[1]]);
    expect(filterStaffOrders(orders, "ALICE")).toEqual([orders[0]]);
    expect(filterStaffOrders(orders, "   ")).toBe(orders);
  });

  it("groups active online kitchen items by name, notes, and status", () => {
    const sharedItem = staffItem({
      name: "鹽酥雞",
      status: "PENDING",
      note: "不要胡椒",
      noteOptions: [{ groupName: "辣度", optionName: "小辣", priceDelta: 0 }],
    });
    const orders = [
      staffOrder({
        id: "one",
        orderNo: "A-101",
        tableLabel: "一號桌",
        items: [
          { ...sharedItem, id: "item-1", quantity: 2 },
          staffItem({ id: "served", name: "可樂", status: "SERVED" }),
        ],
      }),
      staffOrder({
        id: "two",
        orderNo: "A-102",
        items: [{ ...sharedItem, id: "item-2", quantity: 1 }],
      }),
      staffOrder({
        id: "offline",
        orderNo: "OFF-1",
        source: "OFFLINE_POS",
        items: [{ ...sharedItem, id: "item-offline", quantity: 5 }],
      }),
    ];

    expect(selectStaffOrderKitchenGroups(orders)).toEqual([{
      key: JSON.stringify(["鹽酥雞", "辣度：小辣 · 不要胡椒", "PENDING"]),
      name: "鹽酥雞",
      status: "PENDING",
      quantity: 3,
      itemIds: ["item-1", "item-2"],
      notes: "辣度：小辣 · 不要胡椒",
      tickets: ["A-101 · 一號桌", "A-102"],
    }]);
  });

  it("groups only linked dine-in orders by table and sorts their labels", () => {
    const tableB = staffOrder({
      id: "b",
      fulfillmentType: "DINE_IN",
      diningTableId: "table-b",
      tableLabel: "B桌",
    });
    const tableA = staffOrder({
      id: "a",
      fulfillmentType: "DINE_IN",
      diningTableId: "table-a",
      tableLabel: "A桌",
    });
    const tableASecond = staffOrder({
      id: "a-2",
      fulfillmentType: "DINE_IN",
      diningTableId: "table-a",
      tableLabel: "A桌",
    });
    const takeout = staffOrder({ id: "takeout", fulfillmentType: "TAKEOUT" });
    const unlinked = staffOrder({ id: "unlinked", fulfillmentType: "DINE_IN", diningTableId: null });

    expect(selectStaffOrderDiningTableGroups([
      tableB,
      takeout,
      tableA,
      unlinked,
      tableASecond,
    ])).toEqual([
      { diningTableId: "table-a", tableLabel: "A桌", orders: [tableA, tableASecond] },
      { diningTableId: "table-b", tableLabel: "B桌", orders: [tableB] },
    ]);
  });

  it("keeps the existing fallback label for a linked table without a label", () => {
    const order = staffOrder({
      fulfillmentType: "DINE_IN",
      diningTableId: "table-a",
      tableLabel: null,
    });
    expect(selectStaffOrderDiningTableGroups([order])[0]?.tableLabel).toBe("未指定桌位");
  });
});

function staffOrder(overrides: Partial<StaffOrderDto> = {}): StaffOrderDto {
  return {
    id: "order",
    orderNo: "A-100",
    source: "PUBLIC_QR",
    customerName: "顧客",
    tableLabel: null,
    diningTableId: null,
    fulfillmentType: "TAKEOUT",
    items: [],
    ...overrides,
  } as StaffOrderDto;
}

function staffItem(
  overrides: Partial<StaffOrderDto["items"][number]> = {},
): StaffOrderDto["items"][number] {
  return {
    id: "item",
    name: "餐點",
    unitPrice: 100,
    quantity: 1,
    isOrderDiscountEligible: true,
    note: null,
    status: "PENDING",
    preparingAt: null,
    readyAt: null,
    servedAt: null,
    noteOptions: [],
    ...overrides,
  };
}
