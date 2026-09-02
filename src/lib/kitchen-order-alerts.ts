import type { OrderStatus } from "@prisma/client";

export const kitchenAlertOrderStatuses = [
  "WAITING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "PACKING",
  "READY",
] as const satisfies readonly OrderStatus[];

export function reconcileKitchenOrderAlerts(
  knownOrderIds: Set<string>,
  nextOrderIds: readonly string[],
) {
  const newOrderCount = nextOrderIds.filter((orderId) => !knownOrderIds.has(orderId)).length;
  nextOrderIds.forEach((orderId) => knownOrderIds.add(orderId));
  return newOrderCount;
}
