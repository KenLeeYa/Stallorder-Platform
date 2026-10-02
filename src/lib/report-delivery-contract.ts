import { z } from "zod";

export const reportRetrySchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.literal("RETRY_CONFIRMED_FAILURE") }).strict();
export const reportReconcileSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const reportDeliveryQuerySchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
  from: z.iso.datetime().optional(), to: z.iso.datetime().optional(),
  outcome: z.enum(["ALL", "FAILED", "UNKNOWN"]).default("ALL"),
}).strict();
export const reportIntentSchema = z.object({
  version: z.literal(1), stallIds: z.array(z.uuid()).min(1).max(200),
  scheduleFingerprint: z.string().regex(/^[0-9a-f]{64}$/), binding: z.string().regex(/^[0-9a-f]{64}$/),
  key: z.string().regex(/^stallorder-report-[0-9a-f-]{36}$/), mode: z.enum(["REAL", "SIMULATED"]),
}).strict();
export const reportEnvelopeSchema = z.object({ from: z.string(), to: z.array(z.string()).min(1), subject: z.string(), html: z.string(), text: z.string() }).strict();
export type ReportIntent = z.infer<typeof reportIntentSchema>;
export type ReportEnvelope = z.infer<typeof reportEnvelopeSchema>;
export const reportDeliverySummarySchema = z.object({
  id: z.uuid(), version: z.number().int().positive(), status: z.enum(["PROCESSING", "SENT", "SIMULATED", "FAILURE"]),
  effectState: z.enum(["NOT_STARTED", "IN_FLIGHT", "UNKNOWN", "ACCEPTED", "REJECTED", "SUPPRESSED"]).nullable(),
  attempt: z.number().int().nonnegative(), maxAttempts: z.literal(5), reason: z.string().nullable(),
  createdAt: z.iso.datetime(), startedAt: z.iso.datetime(), nextAttemptAt: z.iso.datetime().nullable(),
  leaseExpiresAt: z.iso.datetime().nullable(), acceptedAt: z.iso.datetime().nullable(), reconciledAt: z.iso.datetime().nullable(),
  requestId: z.uuid().nullable(), canRetry: z.boolean(), canReconcile: z.boolean(),
}).strict();
export type ReportDeliverySummary = z.infer<typeof reportDeliverySummarySchema>;
export const reportDeliveryListSchema = z.object({ version: z.literal("v1"), items: z.array(reportDeliverySummarySchema), nextCursor: z.uuid().nullable(), from: z.iso.datetime(), to: z.iso.datetime() }).strict();
export class ReportExecutionError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
