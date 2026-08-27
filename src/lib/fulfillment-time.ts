import { z } from "zod";

export * from "@/lib/fulfillment-time-client";

const version = z.number().int().min(1).max(10_000);
const proposalVersion = z.number().int().min(0).max(10_000);

export const fulfillmentTimeCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("CONFIRM_REQUESTED"),
    version,
  }).strict(),
  z.object({
    operation: z.literal("PROPOSE"),
    version: proposalVersion,
    proposedFulfillmentAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(2).max(200).refine(
      (value) => !/[\r\n]/.test(value),
      "調整原因不可包含換行。",
    ),
  }).strict(),
]);
