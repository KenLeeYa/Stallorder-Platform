import { z } from "zod";

const channelSchema = z.enum([
  "QR",
  "STAFF_POS",
  "LINE_ORDERING",
  "BRANDED_WEB",
  "FOODPANDA",
  "UBER_EATS",
]);

const createCouponCampaignSchema = z.object({
  operation: z.literal("CREATE_COUPON_CAMPAIGN"),
  name: z.string().trim().min(1).max(120),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.number().int().min(1).max(1_000_000),
  budgetAmount: z.number().int().min(1).max(100_000_000),
  perCustomerLimit: z.number().int().min(1).max(100),
  minimumOrderAmount: z.number().int().min(0).max(10_000_000),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  channels: z.array(channelSchema).min(1).max(6).transform((values) => [...new Set(values)]),
}).strict().superRefine((value, context) => {
  if (value.discountType === "PERCENT" && value.discountValue > 100) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "百分比折扣不可超過 100" });
  }
  if (new Date(value.endsAt) <= new Date(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "結束時間必須晚於開始時間" });
  }
});

export const growthCommandSchema = z.discriminatedUnion("operation", [
  createCouponCampaignSchema,
  z.object({
    operation: z.literal("SET_COUPON_CAMPAIGN_STATUS"),
    campaignId: z.string().uuid(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]),
  }).strict(),
]);

export type GrowthCommand = z.infer<typeof growthCommandSchema>;

const campaignTransitions = {
  DRAFT: ["ACTIVE", "ENDED"],
  ACTIVE: ["PAUSED", "ENDED"],
  PAUSED: ["ACTIVE", "ENDED"],
  ENDED: [],
} as const;

export function assertGrowthCampaignTransition(current: string, next: string) {
  if (current === next) return;
  const allowed = campaignTransitions[current as keyof typeof campaignTransitions] ?? [];
  if (!(allowed as readonly string[]).includes(next)) {
    throw new Error("GROWTH_CAMPAIGN_TRANSITION_INVALID");
  }
}

export type RfmSegment = "CHAMPION" | "LOYAL" | "PROMISING" | "AT_RISK" | "HIBERNATING";

export function classifyRfmSegment(input: {
  recencyDays: number;
  frequency: number;
  monetaryAmount: number;
}): RfmSegment {
  if (input.recencyDays <= 7 && input.frequency >= 10 && input.monetaryAmount >= 3_000) return "CHAMPION";
  if (input.recencyDays <= 30 && input.frequency >= 5) return "LOYAL";
  if (input.recencyDays > 60 && input.frequency >= 3) return "AT_RISK";
  if (input.recencyDays > 90 && input.frequency < 3) return "HIBERNATING";
  return "PROMISING";
}
