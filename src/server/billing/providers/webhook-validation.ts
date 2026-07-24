import { BillingProviderError, type VerifiedBillingEvent } from "./billing-provider";

export function assertWebhookEventNotProcessed(alreadyProcessed: boolean) {
  if (alreadyProcessed) throw new BillingProviderError("DUPLICATE_WEBHOOK_EVENT");
}

export function validateBillingEventPayment(
  event: VerifiedBillingEvent,
  expected: { amount: number; currency: string },
) {
  if (event.amount !== expected.amount) {
    throw new BillingProviderError("PAYMENT_AMOUNT_MISMATCH");
  }
  if (event.currency !== expected.currency) {
    throw new BillingProviderError("PAYMENT_CURRENCY_MISMATCH");
  }
}
