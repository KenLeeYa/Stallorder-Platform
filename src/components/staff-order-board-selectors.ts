import type { OrderItemStatus } from "@prisma/client";
import type { StaffOrderDto } from "@/lib/orders";

export type StaffOrderKitchenGroup = {
  key: string;
  name: string;
  status: OrderItemStatus;
  quantity: number;
  itemIds: string[];
  notes: string;
  tickets: string[];
};

export type StaffOrderDiningTableGroup = {
  diningTableId: string;
  tableLabel: string;
  orders: StaffOrderDto[];
};

export function filterStaffOrders(
  orders: StaffOrderDto[],
  query: string,
): StaffOrderDto[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  if (!normalizedQuery) return orders;
  return orders.filter((order) => [order.orderNo, order.tableLabel ?? "", order.customerName]
    .some((value) => value.toLocaleLowerCase("zh-TW").includes(normalizedQuery)));
}

export function selectStaffOrderKitchenGroups(
  orders: StaffOrderDto[],
): StaffOrderKitchenGroup[] {
  const groups = new Map<string, StaffOrderKitchenGroup>();
  for (const order of orders) {
    if (order.source === "OFFLINE_POS") continue;
    for (const item of order.items) {
      if (item.status === "SERVED") continue;
      const notes = [
        item.noteOptions.map((option) => `${option.groupName}：${option.optionName}`).join("、"),
        item.note ?? "",
      ].filter(Boolean).join(" · ");
      const key = JSON.stringify([item.name, notes, item.status]);
      const current = groups.get(key) ?? {
        key,
        name: item.name,
        status: item.status,
        quantity: 0,
        itemIds: [],
        notes,
        tickets: [],
      };
      current.quantity += item.quantity;
      current.itemIds.push(item.id);
      current.tickets.push(`${order.orderNo}${order.tableLabel ? ` · ${order.tableLabel}` : ""}`);
      groups.set(key, current);
    }
  }
  return [...groups.values()].sort((left, right) => (
    left.status.localeCompare(right.status) || left.name.localeCompare(right.name, "zh-TW")
  ));
}

export function selectStaffOrderDiningTableGroups(
  orders: StaffOrderDto[],
): StaffOrderDiningTableGroup[] {
  const groups = new Map<string, StaffOrderDiningTableGroup>();
  for (const order of orders) {
    if (order.fulfillmentType !== "DINE_IN" || !order.diningTableId) continue;
    const current = groups.get(order.diningTableId) ?? {
      diningTableId: order.diningTableId,
      tableLabel: order.tableLabel ?? "未指定桌位",
      orders: [],
    };
    current.orders.push(order);
    groups.set(order.diningTableId, current);
  }
  return [...groups.values()].sort((left, right) => (
    left.tableLabel.localeCompare(right.tableLabel, "zh-TW")
  ));
}
