import type { OrderItemStatus, OrderStatus, UserRole } from "@prisma/client";

const nextItemStatus: Record<OrderItemStatus, OrderItemStatus | null> = {
  PENDING: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
  SERVED: null,
};

export function canTransitionOrderItem(
  current: OrderItemStatus,
  next: OrderItemStatus,
  role: UserRole,
) {
  if (role === "KITCHEN") return false;
  if (nextItemStatus[current] !== next) return false;
  return true;
}

export function deriveOrderStatusFromItems(
  current: OrderStatus,
  itemStatuses: readonly OrderItemStatus[],
): OrderStatus {
  if (itemStatuses.length === 0 || current === "WAITING_CONFIRMATION") return current;
  if (itemStatuses.every((status) => status === "READY" || status === "SERVED")) return "READY";
  if (current === "PACKING") return "PACKING";
  if (itemStatuses.some((status) => status !== "PENDING")) return "PREPARING";
  return "CONFIRMED";
}
