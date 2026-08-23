import type { CanonicalPaymentStatus } from "./types";
import { PaymentProviderError } from "./types";

const allowedTransitions: Record<CanonicalPaymentStatus, readonly CanonicalPaymentStatus[]> = {
  CREATED: ["PENDING", "REQUIRES_CUSTOMER_ACTION", "FAILED", "CANCELLED", "EXPIRED"],
  PENDING: ["REQUIRES_CUSTOMER_ACTION", "AUTHORIZED", "PAID", "FAILED", "CANCELLED", "EXPIRED", "RECONCILIATION_REQUIRED"],
  REQUIRES_CUSTOMER_ACTION: ["PENDING", "AUTHORIZED", "PAID", "FAILED", "CANCELLED", "EXPIRED", "RECONCILIATION_REQUIRED"],
  AUTHORIZED: ["PAID", "FAILED", "CANCELLED", "EXPIRED", "RECONCILIATION_REQUIRED"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED", "RECONCILIATION_REQUIRED"],
  FAILED: ["RECONCILIATION_REQUIRED"],
  CANCELLED: ["RECONCILIATION_REQUIRED"],
  EXPIRED: ["RECONCILIATION_REQUIRED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED", "RECONCILIATION_REQUIRED"],
  REFUNDED: ["RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["PAID", "FAILED", "CANCELLED", "EXPIRED", "PARTIALLY_REFUNDED", "REFUNDED"],
};

export type PaymentTransitionEvidence =
  | "SIGNED_WEBHOOK"
  | "VERIFIED_PROVIDER_QUERY"
  | "VERIFIED_PROVIDER_CONFIRMATION"
  | "PRIVILEGED_RECONCILIATION"
  | "BROWSER_RETURN";

const paidEvidence = new Set<PaymentTransitionEvidence>([
  "SIGNED_WEBHOOK",
  "VERIFIED_PROVIDER_QUERY",
  "VERIFIED_PROVIDER_CONFIRMATION",
  "PRIVILEGED_RECONCILIATION",
]);

export function assertPaymentTransition(
  current: CanonicalPaymentStatus,
  next: CanonicalPaymentStatus,
  evidence: PaymentTransitionEvidence,
) {
  if (current === next) return;
  if (!allowedTransitions[current].includes(next)) {
    throw new PaymentProviderError("PAYMENT_STATUS_TRANSITION_INVALID");
  }
  if ((next === "PAID" || next === "AUTHORIZED") && !paidEvidence.has(evidence)) {
    throw new PaymentProviderError("PAYMENT_TRUSTED_EVIDENCE_REQUIRED");
  }
}

export function isTerminalPaymentStatus(status: CanonicalPaymentStatus) {
  return status === "FAILED" || status === "CANCELLED" || status === "EXPIRED" || status === "REFUNDED";
}
