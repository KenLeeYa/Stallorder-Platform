import "server-only";

import { NextResponse } from "next/server";
import { billingWorkflowErrorFromUnknown } from "@/server/billing/billing-workflow-service";

export function billingWorkflowErrorResponse(error: unknown, requestId: string) {
  const workflowError = billingWorkflowErrorFromUnknown(error);
  if (!workflowError) return null;
  const conflictCodes = new Set([
    "SUBSCRIPTION_STATE_CONFLICT",
    "RENEWAL_TOO_EARLY",
    "PLAN_CHANGE_ALREADY_PENDING",
    "ADDITIONAL_STALL_ALREADY_PENDING",
    "INVOICE_NOT_PAYABLE",
    "INVOICE_NOT_EDITABLE",
    "INVOICE_AMOUNT_MISMATCH",
    "INVOICE_HAS_PENDING_PAYMENT",
    "PAYMENT_STATE_CONFLICT",
    "PAYMENT_IDEMPOTENCY_CONFLICT",
    "PAYMENT_AMOUNT_EXCEEDS_DUE",
    "UNPAID_INVOICE_EXISTS",
    "ORDER_PACKAGE_NOT_AVAILABLE",
    "ADD_ON_NOT_AVAILABLE",
    "REQUEST_STATE_CONFLICT",
  ]);
  const notFoundCodes = new Set([
    "SUBSCRIPTION_NOT_FOUND",
    "INVOICE_NOT_FOUND",
    "PAYMENT_NOT_FOUND",
    "REQUEST_NOT_FOUND",
  ]);
  return NextResponse.json(
    { error: workflowError.message, code: workflowError.code },
    {
      status: notFoundCodes.has(workflowError.code) ? 404 : conflictCodes.has(workflowError.code) ? 409 : 400,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  );
}
