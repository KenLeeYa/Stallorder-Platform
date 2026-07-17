import { z } from "zod";

export const batchOrderingSchema = z.object({
  action: z.enum(["PAUSE", "RESUME"]),
  stallIds: z.array(z.string().uuid()).min(1).max(50).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: "攤位清單不可重複。" },
  ),
  confirmation: z.literal("CONFIRM_BATCH_ACTION"),
}).strict();

export const alertActionSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "RESOLVED"]),
}).strict();

export function orderingStateForBatchAction(action: "PAUSE" | "RESUME") {
  return action === "PAUSE"
    ? { businessStatus: "PAUSED" as const, orderingEnabled: false }
    : { businessStatus: "OPEN" as const, orderingEnabled: true };
}
