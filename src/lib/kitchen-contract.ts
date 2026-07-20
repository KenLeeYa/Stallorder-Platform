import { z } from "zod";

export const kitchenBoardModes = ["ORDER", "ITEM", "STATION"] as const;
export type KitchenBoardMode = (typeof kitchenBoardModes)[number];
export type KitchenTaskState = "PENDING" | "PREPARING" | "COMPLETED" | "CANCELLED";
export type KitchenOperationalOrderStatus = "CONFIRMED" | "PREPARING" | "PACKING" | "READY";

const uuid = z.string().uuid();
export const kitchenBoardQuerySchema = z.object({ stationId: uuid.optional() }).strict();
const stationFields = {
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,31}$/),
  description: z.string().trim().min(1).max(300).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};

export const kitchenStationCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("CREATE_STATION"), ...stationFields }).strict(),
  z.object({ operation: z.literal("UPDATE_STATION"), stationId: uuid, ...stationFields }).strict(),
  z.object({ operation: z.literal("DELETE_STATION"), stationId: uuid }).strict(),
  z.object({
    operation: z.literal("CREATE_ASSIGNMENT"),
    stationId: uuid,
    categoryId: uuid.nullable(),
    productId: uuid.nullable(),
  }).strict().refine(
    (value) => Number(value.categoryId !== null) + Number(value.productId !== null) === 1,
    { message: "分類與商品必須擇一。" },
  ),
  z.object({ operation: z.literal("DELETE_ASSIGNMENT"), assignmentId: uuid }).strict(),
]);

export const kitchenSettingsSchema = z.object({
  warningMinutes: z.number().int().min(1).max(120),
  criticalMinutes: z.number().int().min(2).max(240),
  defaultView: z.enum(kitchenBoardModes),
}).strict().refine(
  (value) => value.criticalMinutes > value.warningMinutes,
  { path: ["criticalMinutes"], message: "嚴重逾時必須大於警示時間。" },
);

export const kitchenTaskCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("UPDATE_TASK"),
    taskId: uuid,
    status: z.enum(["PENDING", "PREPARING", "COMPLETED"]),
  }).strict(),
  z.object({ operation: z.literal("COMPLETE_ORDER"), orderId: uuid }).strict(),
]);

export type KitchenBoardTask = {
  id: string;
  orderId: string;
  orderItemId: string;
  orderNo: string;
  pickupCode: string | null;
  source: string;
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
