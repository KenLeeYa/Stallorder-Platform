import type { MerchantApplicationRiskLevel } from "@prisma/client";

export const merchantApplicationRiskReasons = [
  "PROFILE_ALREADY_HAS_ORGANIZATION",
  "DUPLICATE_EMAIL",
  "DUPLICATE_PHONE",
  "DUPLICATE_REGISTRATION_NUMBER",
  "DUPLICATE_SLUG",
  "HIGH_APPLICATION_RATE",
  "DISPOSABLE_EMAIL_SUSPECTED",
  "INVALID_BUSINESS_DATA",
  "PRIOR_REJECTION",
  "SECURITY_EVENT_MATCH",
] as const;

export type MerchantApplicationRiskReason = (typeof merchantApplicationRiskReasons)[number];

export function classifyMerchantApplicationRisk(reasons: readonly MerchantApplicationRiskReason[]) {
  const uniqueReasons = [...new Set(reasons)];
  let level: MerchantApplicationRiskLevel = "LOW";
  if (uniqueReasons.some((reason) => [
    "HIGH_APPLICATION_RATE",
    "SECURITY_EVENT_MATCH",
  ].includes(reason))) level = "BLOCKED";
  else if (uniqueReasons.some((reason) => [
    "DUPLICATE_REGISTRATION_NUMBER",
    "PRIOR_REJECTION",
    "INVALID_BUSINESS_DATA",
  ].includes(reason))) level = "HIGH";
  else if (uniqueReasons.length > 0) level = "MEDIUM";
  return { level, reasons: uniqueReasons };
}
