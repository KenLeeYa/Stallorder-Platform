import "server-only";

export const billingProviderErrorCodes = [
  "BILLING_PROVIDER_NOT_CONFIGURED",
  "BILLING_OPERATION_NOT_SUPPORTED",
  "INVALID_WEBHOOK_SIGNATURE",
  "INVALID_WEBHOOK_EVENT",
  "DUPLICATE_WEBHOOK_EVENT",
  "PAYMENT_AMOUNT_MISMATCH",
  "PAYMENT_CURRENCY_MISMATCH",
] as const;

export type BillingProviderErrorCode = (typeof billingProviderErrorCodes)[number];

export class BillingProviderError extends Error {
  constructor(readonly code: BillingProviderErrorCode) {
    super(code);
    this.name = "BillingProviderError";
  }
}

export type CreateBillingCustomerInput = {
  organizationId: string;
  email?: string;
};

export type BillingCustomerResult = {
  provider: string;
  providerCustomerId: string;
  status: "ACTIVE";
};

export type CreateCheckoutInput = {
  organizationId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  returnUrl?: string;
};

export type CheckoutResult = {
  provider: string;
  providerTransactionId: string | null;
  status: "REQUIRES_MANUAL_PAYMENT" | "PENDING" | "SUCCEEDED";
  redirectUrl: string | null;
};

export type CreateRecurringAgreementInput = {
  organizationId: string;
  planVersionId: string;
  amount: number;
  currency: string;
};

export type RecurringAgreementResult = {
  provider: string;
  providerAgreementId: string;
  status: "PENDING" | "ACTIVE";
};

export type CancelRecurringAgreementInput = {
  providerAgreementId: string;
};

export type QueryPaymentInput = {
  invoiceId: string;
  providerTransactionId: string;
};

export type PaymentResult = {
  provider: string;
  providerTransactionId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "REFUNDED";
};

export type RefundPaymentInput = {
  invoiceId: string;
  providerTransactionId: string;
  amount: number;
  currency: string;
};

export type RefundResult = {
  provider: string;
  providerTransactionId: string;
  status: "PENDING" | "REFUNDED";
};

export type VerifiedBillingEvent = {
  provider: string;
  providerEventId: string;
  eventType: string;
  providerTransactionId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  occurredAt: Date;
};

export interface BillingProvider {
  readonly code: string;
  createCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomerResult>;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult>;
  createRecurringAgreement(input: CreateRecurringAgreementInput): Promise<RecurringAgreementResult>;
  cancelRecurringAgreement(input: CancelRecurringAgreementInput): Promise<void>;
  queryPayment(input: QueryPaymentInput): Promise<PaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundResult>;
  verifyWebhook(request: Request): Promise<VerifiedBillingEvent>;
}
