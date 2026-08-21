import { z } from "zod";

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const contactReferenceSchema = z.string()
  .min(12)
  .max(300)
  .regex(/^(vault|kms):\/\/[A-Za-z0-9._:/-]+$/);
const boundedCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/);

export const crmConsentOptInSchema = z.object({
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  contactIdentifierHash: sha256HexSchema,
  contactReference: contactReferenceSchema,
  contactType: z.enum(["PHONE", "EMAIL"]),
  contactVerifiedAt: z.string().datetime({ offset: true }),
  purposeCode: boundedCodeSchema,
  noticeVersion: z.string().trim().min(1).max(80),
  consentSource: boundedCodeSchema,
  lawfulBasis: z.literal("CONSENT"),
  decision: z.literal("EXPLICIT_OPT_IN"),
}).strict();

export const crmConsentWithdrawalSchema = z.object({
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  profileId: z.string().uuid(),
  purposeCode: boundedCodeSchema,
  withdrawalSource: boundedCodeSchema,
  withdrawalReason: z.string().trim().min(1).max(300),
}).strict();

export const crmUnsubscribeSchema = z.object({
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  profileId: z.string().uuid(),
  unsubscribeSource: boundedCodeSchema,
}).strict();

export const loyaltyPointsEventSchema = z.object({
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  accountId: z.string().uuid(),
  entryType: z.enum(["EARN", "ADJUST", "EXPIRE", "REVERSE"]),
  pointsDelta: z.number().int().min(-1_000_000).max(1_000_000).refine(
    (value) => value !== 0,
    "pointsDelta must not be zero",
  ),
  orderId: z.string().uuid().nullable().optional(),
  sourceEventType: boundedCodeSchema,
  sourceEventId: z.string().trim().min(1).max(160),
  reversalOfLedgerId: z.string().uuid().nullable().optional(),
  actorProfileId: z.string().uuid().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.entryType === "EARN" && value.pointsDelta <= 0) {
    context.addIssue({ code: "custom", path: ["pointsDelta"], message: "EARN must be positive" });
  }
  if (["EXPIRE", "REVERSE"].includes(value.entryType) && value.pointsDelta >= 0) {
    context.addIssue({ code: "custom", path: ["pointsDelta"], message: `${value.entryType} must be negative` });
  }
  if (value.entryType === "REVERSE" && !value.reversalOfLedgerId) {
    context.addIssue({ code: "custom", path: ["reversalOfLedgerId"], message: "REVERSE requires its original entry" });
  }
  if (value.entryType !== "REVERSE" && value.reversalOfLedgerId) {
    context.addIssue({ code: "custom", path: ["reversalOfLedgerId"], message: "only REVERSE links an original entry" });
  }
});

export const crmDataSubjectSchema = z.object({
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  profileId: z.string().uuid(),
}).strict();

export const crmErasureSchema = crmDataSubjectSchema.extend({
  subjectHash: sha256HexSchema,
  reason: z.string().trim().min(1).max(300),
}).strict();

export type CrmConsentOptIn = z.infer<typeof crmConsentOptInSchema>;
export type CrmConsentWithdrawal = z.infer<typeof crmConsentWithdrawalSchema>;
export type CrmUnsubscribe = z.infer<typeof crmUnsubscribeSchema>;
export type LoyaltyPointsEvent = z.infer<typeof loyaltyPointsEventSchema>;
export type CrmDataSubjectRequest = z.infer<typeof crmDataSubjectSchema>;
export type CrmErasureRequest = z.infer<typeof crmErasureSchema>;
