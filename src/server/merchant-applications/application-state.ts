import type { MerchantApplicationStatus } from "@prisma/client";

const applicantTransitions: Partial<Record<MerchantApplicationStatus, readonly MerchantApplicationStatus[]>> = {
  DRAFT: ["SUBMITTED"],
  NEEDS_INFO: ["SUBMITTED", "WITHDRAWN"],
  PENDING_REVIEW: ["WITHDRAWN"],
};

const reviewerTransitions: Partial<Record<MerchantApplicationStatus, readonly MerchantApplicationStatus[]>> = {
  SUBMITTED: ["PENDING_REVIEW"],
  PENDING_REVIEW: ["NEEDS_INFO", "APPROVED", "REJECTED", "WITHDRAWN"],
  NEEDS_INFO: ["PENDING_REVIEW", "WITHDRAWN"],
};

export function canTransitionMerchantApplication(
  current: MerchantApplicationStatus,
  next: MerchantApplicationStatus,
  actor: "APPLICANT" | "PLATFORM_ADMIN",
) {
  const transitions = actor === "APPLICANT" ? applicantTransitions : reviewerTransitions;
  return transitions[current]?.includes(next) ?? false;
}

export function assertMerchantApplicationTransition(
  current: MerchantApplicationStatus,
  next: MerchantApplicationStatus,
  actor: "APPLICANT" | "PLATFORM_ADMIN",
) {
  if (!canTransitionMerchantApplication(current, next, actor)) {
    throw new Error("MERCHANT_APPLICATION_TRANSITION_INVALID");
  }
}
