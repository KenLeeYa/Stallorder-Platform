import { z } from "zod";

const dimension = z.string().trim().min(2).max(40)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/));

const createCampaign = z.object({
  operation: z.literal("CREATE_CAMPAIGN"),
  marketEventId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  source: dimension,
  medium: dimension,
  campaignCode: dimension,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "結束時間必須晚於開始時間" });
  }
});

export const eventGrowthCommandSchema = z.discriminatedUnion("operation", [
  createCampaign,
  z.object({
    operation: z.literal("SET_CAMPAIGN_STATUS"),
    campaignId: z.string().uuid(),
    status: z.enum(["ACTIVE", "PAUSED", "ENDED"]),
  }).strict(),
  z.object({
    operation: z.literal("CREATE_EXPENSE"),
    marketEventId: z.string().uuid(),
    category: z.enum(["BOOTH_FEE", "ADVERTISING", "TRANSPORT", "STAFF", "OTHER"]),
    amount: z.number().int().min(0).max(100_000_000),
    note: z.string().trim().min(1).max(300),
    incurredAt: z.string().datetime({ offset: true }),
  }).strict(),
]);

export type EventGrowthCommand = z.infer<typeof eventGrowthCommandSchema>;

const allowedCampaignTransitions: Record<string, readonly string[]> = {
  DRAFT: ["ACTIVE", "ENDED"],
  ACTIVE: ["PAUSED", "ENDED"],
  PAUSED: ["ACTIVE", "ENDED"],
  ENDED: [],
};

export function assertEventCampaignTransition(current: string, next: string) {
  if (!allowedCampaignTransitions[current]?.includes(next)) {
    throw new Error("EVENT_CAMPAIGN_TRANSITION_INVALID");
  }
}
