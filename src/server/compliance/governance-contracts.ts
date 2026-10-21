import { z } from "zod";

const reason = z.string().trim().min(3).max(2000);
const evidence = z.string().trim().min(8).max(300);
const record = { id: z.uuid(), expectedVersion: z.int().positive() };
export const governanceCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("DETAIL"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("EXTEND"), ...record, days: z.int().min(1).max(30), reason,
    notifiedAt: z.iso.datetime({ offset: true }), deliveryEvidence: evidence }).strict(),
  z.object({ action: z.literal("EXPORT"), ...record }).strict(),
  z.object({ action: z.literal("REVOKE_EXPORT"), id: z.uuid(), reason }).strict(),
  z.object({ action: z.literal("DELETE_PREVIEW"), ...record }).strict(),
  z.object({ action: z.literal("DELETE_EXECUTE"), ...record, planDigest: z.string().regex(/^[a-f0-9]{64}$/), reason }).strict(),
  z.object({ action: z.literal("RECORD_RESULT"), ...record, reason, executionEvidence: evidence }).strict(),
  z.object({ action: z.literal("HOLD"), orderId: z.uuid().nullable(), stallId: z.uuid().nullable(),
    classes: z.array(z.enum(["CUSTOMER_CONTACT", "SECURITY_EVIDENCE", "ACCOUNTING_VOUCHER", "ACCOUNTING_BOOK", "PRINT_PAYLOAD"])).min(1).max(5),
    reason, reviewAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal("RELEASE_HOLD"), id: z.uuid(), reason }).strict(),
  z.object({ action: z.literal("SUPPORT_GRANT"), actorId: z.uuid(), purpose: z.string().trim().min(3).max(300), minutes: z.int().min(1).max(60) }).strict(),
  z.object({ action: z.literal("SUPPORT_REVOKE"), id: z.uuid(), reason }).strict(),
]);
export type GovernanceCommand = z.infer<typeof governanceCommand>;
export function governedAction(command: GovernanceCommand) {
  if (command.action === "EXPORT" || command.action === "DETAIL") return "PRIVACY_EXPORT";
  if (["DELETE_EXECUTE", "HOLD", "RELEASE_HOLD"].includes(command.action)) return "PRIVACY_DELETE";
  if (command.action === "SUPPORT_GRANT") return "SUPPORT_GRANT";
  return null;
}
// The browser and server bind the proof to the same validated content and tenant.
export function commandBinding(organizationId: string, command: unknown) {
  return JSON.stringify(["governance-v1", organizationId, command]);
}

export const incidentCommand = z.object({
  id: z.uuid().optional(), expectedVersion: z.int().positive().optional(),
  state: z.enum(["DETECTED", "TRIAGED", "CONTAINING", "INVESTIGATING", "RECOVERING", "CLOSED"]),
  awarenessAt: z.iso.datetime({ offset: true }), facts: reason,
  digitalIndustryApplicable: z.boolean().nullable(), normalOperationsAtRisk: z.boolean().nullable(), largeSubjectImpact: z.boolean().nullable(),
  notificationStatus: z.enum(["ASSESSING", "DRAFT", "SUBMITTED", "NOT_REQUIRED"]),
  submissionEvidence: evidence.nullable(), affectedCount: z.int().nonnegative().nullable(),
  countConfidence: z.enum(["UNKNOWN", "ESTIMATE", "VERIFIED"]),
}).strict();
export function canAdvanceIncident(from: string, to: string) {
  const states = ["DETECTED", "TRIAGED", "CONTAINING", "INVESTIGATING", "RECOVERING", "CLOSED"];
  return from !== "CLOSED" && (from === to || states.indexOf(to) === states.indexOf(from) + 1);
}
