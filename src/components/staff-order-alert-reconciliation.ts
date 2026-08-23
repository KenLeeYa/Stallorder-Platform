type AlertableOrder = {
  id: string;
  status: string;
};

export function reconcileStaffOrderAlerts(
  previousStatuses: Map<string, string>,
  nextOrders: readonly AlertableOrder[],
) {
  let newOrderCount = 0;
  let modifiedOrderCount = 0;
  for (const order of nextOrders) {
    if (order.status !== "WAITING_CONFIRMATION") continue;
    const previousStatus = previousStatuses.get(order.id);
    if (previousStatus === undefined) newOrderCount += 1;
    else if (previousStatus !== "WAITING_CONFIRMATION") modifiedOrderCount += 1;
  }

  previousStatuses.clear();
  nextOrders.forEach((order) => previousStatuses.set(order.id, order.status));
  return { newOrderCount, modifiedOrderCount };
}
