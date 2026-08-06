import { z } from "zod";

const version = z.number().int().min(1).max(10_000);

export const fulfillmentTimeCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("CONFIRM_REQUESTED"),
    version,
  }).strict(),
  z.object({
    operation: z.literal("PROPOSE"),
    version,
    proposedFulfillmentAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(2).max(200).refine(
      (value) => !/[\r\n]/.test(value),
      "調整原因不可包含換行。",
    ),
  }).strict(),
]);

export function fulfillmentTimeBlocksProduction(state: string) {
  return state === "REQUESTED" || state === "CUSTOMER_ACTION_REQUIRED";
}
