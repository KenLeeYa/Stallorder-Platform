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

type FulfillmentTimestamp = Date | string | null | undefined;

export type FulfillmentScheduleInput = {
  fulfillmentTimeState: string;
  committedFulfillmentAt: FulfillmentTimestamp;
  requestedFulfillmentAt: FulfillmentTimestamp;
  scheduledPickupAt: FulfillmentTimestamp;
};

export type FulfillmentProductionReadiness =
  | "BLOCKED"
  | "ASAP"
  | "OVERDUE"
  | "DUE"
  | "FUTURE";

export type FulfillmentProductionTiming = {
  readiness: FulfillmentProductionReadiness;
  effectiveFulfillmentAt: Date | null;
  fulfillmentBusinessDate: string | null;
  currentBusinessDate: string;
  productionBlocked: boolean;
};

export function resolveEffectiveFulfillmentAt(
  input: Pick<
    FulfillmentScheduleInput,
    "committedFulfillmentAt" | "requestedFulfillmentAt" | "scheduledPickupAt"
  >,
) {
  for (const candidate of [
    input.committedFulfillmentAt,
    input.requestedFulfillmentAt,
    input.scheduledPickupAt,
  ]) {
    if (candidate === null || candidate === undefined) continue;
    const value = candidate instanceof Date ? new Date(candidate.getTime()) : new Date(candidate);
    if (Number.isFinite(value.getTime())) return value;
  }
  return null;
}

export function stallBusinessDateKey(
  value: Date | string,
  timeZone: string,
  businessDayCutoffHour = 0,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("INVALID_FULFILLMENT_TIMESTAMP");
  if (!Number.isInteger(businessDayCutoffHour)
    || businessDayCutoffHour < 0
    || businessDayCutoffHour > 23) {
    throw new RangeError("INVALID_BUSINESS_DAY_CUTOFF_HOUR");
  }

  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const wallClock = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) - businessDayCutoffHour,
  ));
  return wallClock.toISOString().slice(0, 10);
}

export function classifyFulfillmentForProduction(
  input: FulfillmentScheduleInput,
  context: {
    timeZone: string;
    businessDayCutoffHour: number;
    now?: Date;
  },
): FulfillmentProductionTiming {
  const now = context.now ?? new Date();
  const currentBusinessDate = stallBusinessDateKey(
    now,
    context.timeZone,
    context.businessDayCutoffHour,
  );
  const effectiveFulfillmentAt = resolveEffectiveFulfillmentAt(input);
  const fulfillmentBusinessDate = effectiveFulfillmentAt
    ? stallBusinessDateKey(
        effectiveFulfillmentAt,
        context.timeZone,
        context.businessDayCutoffHour,
      )
    : null;

  if (fulfillmentTimeBlocksProduction(input.fulfillmentTimeState)) {
    return {
      readiness: "BLOCKED",
      effectiveFulfillmentAt,
      fulfillmentBusinessDate,
      currentBusinessDate,
      productionBlocked: true,
    };
  }
  if (fulfillmentBusinessDate === null) {
    return {
      readiness: "ASAP",
      effectiveFulfillmentAt,
      fulfillmentBusinessDate,
      currentBusinessDate,
      productionBlocked: false,
    };
  }

  const readiness = fulfillmentBusinessDate > currentBusinessDate
    ? "FUTURE"
    : fulfillmentBusinessDate < currentBusinessDate
      ? "OVERDUE"
      : "DUE";
  return {
    readiness,
    effectiveFulfillmentAt,
    fulfillmentBusinessDate,
    currentBusinessDate,
    productionBlocked: readiness === "FUTURE",
  };
}

export function classifyStallOrderForProduction(
  input: FulfillmentScheduleInput & {
    stall: {
      timezone: string;
      orderingSettings: { businessDayCutoffHour: number } | null;
    };
  },
  now = new Date(),
) {
  return classifyFulfillmentForProduction(input, {
    timeZone: input.stall.timezone,
    businessDayCutoffHour: input.stall.orderingSettings?.businessDayCutoffHour ?? 0,
    now,
  });
}
