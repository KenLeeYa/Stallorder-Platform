import { classifyFulfillmentForProduction } from "@/lib/fulfillment-time";

export const kitchenBoardModes = ["ORDER", "ITEM", "STATION"] as const;
export type KitchenBoardMode = (typeof kitchenBoardModes)[number];
export type KitchenTaskState = "PENDING" | "PREPARING" | "COMPLETED" | "CANCELLED";
export type KitchenOperationalOrderStatus = "CONFIRMED" | "PREPARING" | "PACKING" | "READY";

export type KitchenBoardTask = {
  id: string;
  orderId: string;
  orderItemId: string;
  orderNo: string;
  pickupCode: string | null;
  source: string;
  externalProvider: string | null;
  externalOrderNumber: string | null;
  scheduledPickupAt: string | null;
  requestedFulfillmentAt: string | null;
  committedFulfillmentAt: string | null;
  fulfillmentTimeState: string;
  riderPickupAt: string | null;
  fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
  tableLabel: string | null;
  orderNote: string | null;
  orderStatus: KitchenOperationalOrderStatus;
  orderCreatedAt: string;
  confirmedAt: string | null;
  itemName: string;
  quantity: number;
  itemNote: string | null;
  modifiers: string[];
  station: { id: string; name: string; code: string };
  status: KitchenTaskState;
  startedAt: string | null;
  completedAt: string | null;
  assignedTo: { id: string; displayName: string } | null;
};

export function partitionKitchenTasksByFulfillmentDate(
  tasks: KitchenBoardTask[],
  context: { timeZone: string; businessDayCutoffHour: number; now: Date },
) {
  const currentTasks: KitchenBoardTask[] = [];
  const futureReservations: KitchenBoardTask[] = [];
  for (const task of tasks) {
    const timing = classifyFulfillmentForProduction(task, context);
    if (
      timing.readiness === "FUTURE"
      && task.orderStatus === "CONFIRMED"
      && task.status === "PENDING"
    ) futureReservations.push(task);
    else currentTasks.push(task);
  }
  return { currentTasks, futureReservations };
}

export type KitchenItemAggregate = {
  key: string;
  stationId: string;
  stationName: string;
  itemName: string;
  itemNote: string | null;
  orderNote: string | null;
  modifiers: string[];
  quantity: number;
  taskIds: string[];
  statuses: KitchenTaskState[];
};

export function canTransitionKitchenTask(current: KitchenTaskState, next: KitchenTaskState) {
  if (current === "CANCELLED" || next === "CANCELLED" || current === next) return false;
  if (next === "PENDING") return current === "PREPARING" || current === "COMPLETED";
  if (next === "PREPARING") return current === "PENDING";
  return current === "PREPARING";
}

export function kitchenWaitLevel(
  elapsedMinutes: number,
  warningMinutes: number,
  criticalMinutes: number,
) {
  if (elapsedMinutes >= criticalMinutes) return "CRITICAL" as const;
  if (elapsedMinutes >= warningMinutes) return "WARNING" as const;
  return "NORMAL" as const;
}

export function kitchenWaitDisplay(
  now: number,
  effectiveFulfillmentAt: number | null,
  fallbackStartedAt: number,
) {
  if (effectiveFulfillmentAt !== null && effectiveFulfillmentAt > now) {
    const minutesUntil = Math.ceil((effectiveFulfillmentAt - now) / 60_000);
    return { elapsedMinutes: 0, label: `距預約 ${minutesUntil} 分`, beforeFulfillment: true };
  }
  const startedAt = effectiveFulfillmentAt ?? fallbackStartedAt;
  const elapsedMinutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  return {
    elapsedMinutes,
    label: effectiveFulfillmentAt === null
      ? `已等待 ${elapsedMinutes} 分`
      : `已逾預約 ${elapsedMinutes} 分`,
    beforeFulfillment: false,
  };
}

export function preserveKitchenOrderProgress(
  current: KitchenOperationalOrderStatus,
  derived: KitchenOperationalOrderStatus,
) {
  const rank: Record<KitchenOperationalOrderStatus, number> = {
    CONFIRMED: 0,
    PREPARING: 1,
    PACKING: 2,
    READY: 3,
  };
  return rank[derived] < rank[current] ? current : derived;
}

export function aggregateKitchenItems(tasks: readonly KitchenBoardTask[]) {
  const groups = new Map<string, KitchenItemAggregate>();
  for (const task of tasks) {
    if (task.status === "CANCELLED") continue;
    const modifiers = [...task.modifiers].sort((left, right) => left.localeCompare(right, "zh-TW"));
    const key = [
      task.station.id,
      task.itemName,
      task.itemNote ?? "",
      task.orderNote ?? "",
      ...modifiers,
    ].join("\u001f");
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += task.quantity;
      existing.taskIds.push(task.id);
      existing.statuses.push(task.status);
    } else {
      groups.set(key, {
        key,
        stationId: task.station.id,
        stationName: task.station.name,
        itemName: task.itemName,
        itemNote: task.itemNote,
        orderNote: task.orderNote,
        modifiers,
        quantity: task.quantity,
        taskIds: [task.id],
        statuses: [task.status],
      });
    }
  }
  return [...groups.values()].sort((left, right) => (
    left.stationName.localeCompare(right.stationName, "zh-TW")
    || left.itemName.localeCompare(right.itemName, "zh-TW")
  ));
}
