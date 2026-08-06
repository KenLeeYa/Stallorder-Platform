import { z } from "zod";

const version = z.number().int().min(1).max(10_000);
const proposalVersion = z.number().int().min(0).max(10_000);

export type FulfillmentTimeState =
  | "NOT_REQUESTED"
  | "REQUESTED"
  | "CONFIRMED"
  | "CUSTOMER_ACTION_REQUIRED"
  | "DECLINED"
  | "EXPIRED";

type FulfillmentTimeReadModelInput = {
  source: string;
  fulfillmentType: string;
  scheduledPickupAt: string | null;
  requestedFulfillmentAt: string | null;
  committedFulfillmentAt: string | null;
  pendingFulfillmentAt: string | null;
  fulfillmentTimeState: FulfillmentTimeState;
  fulfillmentTimeVersion: number;
};

type LegacyFulfillmentTimeInput = {
  source: string;
  fulfillmentType: string;
  scheduledPickupAt: unknown | null;
  requestedFulfillmentAt: unknown | null;
  committedFulfillmentAt: unknown | null;
  pendingFulfillmentAt: unknown | null;
  fulfillmentTimeState: string;
  fulfillmentTimeVersion: number;
};

export function isUninitializedLegacyQrTakeout(input: LegacyFulfillmentTimeInput) {
  return input.source === "QR_MENU"
    && input.fulfillmentType === "TAKEOUT"
    && input.scheduledPickupAt !== null
    && input.requestedFulfillmentAt === null
    && input.committedFulfillmentAt === null
    && input.pendingFulfillmentAt === null
    && input.fulfillmentTimeState === "NOT_REQUESTED"
    && input.fulfillmentTimeVersion === 0;
}

export function resolveFulfillmentTimeReadModel(input: FulfillmentTimeReadModelInput) {
  const hasLegacyScheduledFallback = input.source === "QR_MENU"
    && input.fulfillmentType === "TAKEOUT"
    && input.scheduledPickupAt !== null
    && input.requestedFulfillmentAt === null;
  const isUninitializedLegacy = isUninitializedLegacyQrTakeout(input);

  return {
    requestedFulfillmentAt: hasLegacyScheduledFallback
      ? input.scheduledPickupAt
      : input.requestedFulfillmentAt,
    committedFulfillmentAt: hasLegacyScheduledFallback
      && input.committedFulfillmentAt === null
      ? input.scheduledPickupAt
      : input.committedFulfillmentAt,
    fulfillmentTimeState: isUninitializedLegacy
      ? "CONFIRMED" as const
      : input.fulfillmentTimeState,
  };
}

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

export function fulfillmentTimeBlocksProduction(state: string) {
  return state === "REQUESTED" || state === "CUSTOMER_ACTION_REQUIRED";
}
