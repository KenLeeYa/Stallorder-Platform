import type { InvoiceLifecycleStatus } from "./e-invoice-provider";

export type RefundInvoiceDecision =
  | { action: "NONE"; reason: string }
  | { action: "VOID"; reason: string }
  | { action: "ALLOWANCE"; amount: number; reason: string }
  | { action: "MANUAL_REVIEW"; reason: string };

export function decideRefundInvoiceAction(input: {
  invoiceStatus: InvoiceLifecycleStatus;
  invoiceTotalAmount: number;
  alreadyAllowedAmount: number;
  refundAmount: number;
  providerSupportsVoid: boolean;
  providerSupportsAllowance: boolean;
  policy: { autoVoidOnFullRefund: boolean; allowanceOnPartialRefund: boolean };
}): RefundInvoiceDecision {
  if (!Number.isSafeInteger(input.refundAmount) || input.refundAmount <= 0) {
    return { action: "NONE", reason: "REFUND_AMOUNT_NOT_POSITIVE" };
  }
  if (!["ISSUED", "PARTIALLY_ALLOWED", "FULLY_ALLOWED"].includes(input.invoiceStatus)) {
    return { action: "MANUAL_REVIEW", reason: "INVOICE_STATE_REQUIRES_REVIEW" };
  }
  const remainingAmount = input.invoiceTotalAmount - input.alreadyAllowedAmount;
  if (input.refundAmount > remainingAmount) {
    return { action: "MANUAL_REVIEW", reason: "REFUND_EXCEEDS_UNADJUSTED_INVOICE" };
  }
  const fullRemainingRefund = input.refundAmount === remainingAmount;
  if (
    fullRemainingRefund
    && input.alreadyAllowedAmount === 0
    && input.policy.autoVoidOnFullRefund
    && input.providerSupportsVoid
  ) {
    return { action: "VOID", reason: "FULL_REFUND_POLICY_VOID" };
  }
  if (
    input.providerSupportsAllowance
    && (fullRemainingRefund || input.policy.allowanceOnPartialRefund)
  ) {
    return { action: "ALLOWANCE", amount: input.refundAmount, reason: fullRemainingRefund ? "FULL_ALLOWANCE_REQUIRED" : "PARTIAL_REFUND_POLICY_ALLOWANCE" };
  }
  return { action: "MANUAL_REVIEW", reason: "NO_APPROVED_AUTOMATIC_ADJUSTMENT" };
}
