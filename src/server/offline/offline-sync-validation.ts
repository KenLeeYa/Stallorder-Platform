import type { OfflineOrderState, OfflineOrderSyncRecord } from "@/offline/offline-order-contract";
import { canTransitionOfflineOrder } from "@/offline/offline-order-contract";

const INITIAL_OFFLINE_STATES = new Set<OfflineOrderState>([
  "LOCAL_NEW",
  "LOCAL_CONFIRMED",
]);

export function validateOfflineEventChain(record: OfflineOrderSyncRecord) {
  let current: OfflineOrderState | null = null;
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const event of record.events) {
    const eventTime = Date.parse(event.occurredAtDevice);
    if (
      event.previousState !== current
      || eventTime < previousTime
      || (current === null && !INITIAL_OFFLINE_STATES.has(event.nextState))
      || (
        current !== null
        && event.nextState !== current
        && !canTransitionOfflineOrder(current, event.nextState)
      )
    ) {
      return false;
    }
    current = event.nextState;
    previousTime = eventTime;
  }
  return current === record.order.orderStatus;
}
