import { z } from "zod";

export const catalogChannels = [
  "QR",
  "STAFF_POS",
  "LINE_ORDERING",
  "BRANDED_WEB",
  "FOODPANDA",
  "UBER_EATS",
  "KIOSK",
  "MARKETPLACE",
  "PHONE_ORDER",
  "DELIVERY_PARTNER",
] as const;

export type CatalogChannel = (typeof catalogChannels)[number];

export const catalogVersionStatuses = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "ACTIVE",
  "SUPERSEDED",
  "ROLLED_BACK",
  "FAILED",
  "ARCHIVED",
] as const;

export type CatalogVersionStatus = (typeof catalogVersionStatuses)[number];

const allowedTransitions: Record<CatalogVersionStatus, readonly CatalogVersionStatus[]> = {
  DRAFT: ["IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["APPROVED", "DRAFT", "ARCHIVED"],
  APPROVED: ["SCHEDULED", "PUBLISHING", "DRAFT", "ARCHIVED"],
  SCHEDULED: ["PUBLISHING", "APPROVED", "ARCHIVED"],
  PUBLISHING: ["ACTIVE", "FAILED"],
  ACTIVE: ["SUPERSEDED", "ROLLED_BACK"],
  SUPERSEDED: ["ROLLED_BACK", "ARCHIVED"],
  ROLLED_BACK: ["ARCHIVED"],
  FAILED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: [],
};

export function assertCatalogVersionTransition(
  current: CatalogVersionStatus,
  next: CatalogVersionStatus,
) {
  if (current === next || !allowedTransitions[current].includes(next)) {
    throw new Error("CATALOG_VERSION_TRANSITION_INVALID");
  }
}

const nullableIsoDateTime = z.string().datetime({ offset: true }).nullable().default(null);

export const catalogChannelOverrideSchema = z.object({
  channel: z.enum(catalogChannels),
  productId: z.string().uuid(),
  stallId: z.string().uuid().nullable().default(null),
  regionCode: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/).nullable().default(null),
  priceAmount: z.number().int().min(0).max(100_000_000).nullable().default(null),
  visible: z.boolean().nullable().default(null),
  availableQuantity: z.number().int().min(0).max(1_000_000).nullable().default(null),
  dailyReplenishmentQuantity: z.number().int().min(0).max(1_000_000).nullable().default(null),
  effectiveFrom: nullableIsoDateTime,
  effectiveUntil: nullableIsoDateTime,
  hqLocked: z.boolean().default(false),
}).superRefine((value, context) => {
  if ((value.stallId === null) === (value.regionCode === null)) {
    context.addIssue({
      code: "custom",
      path: ["stallId"],
      message: "請指定一個分店或區域覆寫範圍。",
    });
  }
  if (
    value.effectiveFrom
    && value.effectiveUntil
    && new Date(value.effectiveUntil).getTime() <= new Date(value.effectiveFrom).getTime()
  ) {
    context.addIssue({
      code: "custom",
      path: ["effectiveUntil"],
      message: "結束時間必須晚於開始時間。",
    });
  }
});
