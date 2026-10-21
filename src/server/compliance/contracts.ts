import { z } from "zod";

export const requestTypes = ["ACCESS", "COPY", "CORRECT", "STOP", "DELETE", "MARKETING_STOP", "COMPLAINT"] as const;
export type RequestType = typeof requestTypes[number];
export const requestCommand = z.object({
  operationId: z.uuid(), type: z.enum(requestTypes), policyVersion: z.string().min(1).max(80),
  details: z.string().trim().min(1).max(2000),
}).strict();
export const requestTransition = z.object({
  id: z.uuid(), expectedVersion: z.int().positive(),
  status: z.enum(["VERIFYING", "REVIEWING", "APPROVED", "REJECTED", "EXECUTING", "COMPLETED"]),
  reason: z.string().trim().min(3).max(2000),
}).strict();

export function requestDays(type: RequestType) {
  return ["ACCESS", "COPY", "COMPLAINT"].includes(type) ? 15 : 30;
}
export function requestDueAt(receivedAt: Date, type: RequestType, extensionDays = 0) {
  const maximum = type === "COMPLAINT" ? 0 : requestDays(type);
  if (!Number.isFinite(receivedAt.getTime()) || !Number.isInteger(extensionDays) || extensionDays < 0 || extensionDays > maximum) {
    throw new Error("PRIVACY_DEADLINE_INVALID");
  }
  // Taiwan has no DST. Count calendar days from receipt, never from identity verification.
  return new Date(receivedAt.getTime() + (requestDays(type) + extensionDays) * 86400000);
}
export function canTransition(from: string, to: string) {
  const transitions: Record<string, string[]> = {
    RECEIVED: ["VERIFYING", "REVIEWING"], VERIFYING: ["REVIEWING", "REJECTED"],
    REVIEWING: ["APPROVED", "REJECTED"], APPROVED: ["EXECUTING"], EXECUTING: ["COMPLETED"],
  };
  return transitions[from]?.includes(to) ?? false;
}
export function incidentNotificationDue(input: {
  awarenessAt: Date; digitalIndustryApplicable: boolean | null;
  normalOperationsAtRisk: boolean | null; largeSubjectImpact: boolean | null;
}) {
  if (!Number.isFinite(input.awarenessAt.getTime())) throw new Error("INCIDENT_TIME_INVALID");
  const trigger = input.normalOperationsAtRisk === true || input.largeSubjectImpact === true;
  return input.digitalIndustryApplicable === true && trigger
    ? new Date(input.awarenessAt.getTime() + 72 * 3600000) : null;
}

export function complianceEnabled(environment = process.env) { return environment.COMPLIANCE_ENABLED === "true"; }
