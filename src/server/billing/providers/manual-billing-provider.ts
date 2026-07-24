import {
  BillingProviderError,
  type BillingCustomerResult,
  type BillingProvider,
  type CancelRecurringAgreementInput,
  type CheckoutResult,
  type CreateBillingCustomerInput,
  type CreateCheckoutInput,
  type CreateRecurringAgreementInput,
  type PaymentResult,
  type QueryPaymentInput,
  type RecurringAgreementResult,
  type RefundPaymentInput,
  type RefundResult,
  type VerifiedBillingEvent,
} from "./billing-provider";

export class ManualBillingProvider implements BillingProvider {
  readonly code = "MANUAL";

  async createCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomerResult> {
    return {
      provider: this.code,
      providerCustomerId: `manual:${input.organizationId}`,
      status: "ACTIVE",
    };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    void input;
    return {
      provider: this.code,
      providerTransactionId: null,
      status: "REQUIRES_MANUAL_PAYMENT",
      redirectUrl: null,
    };
  }

  async createRecurringAgreement(input: CreateRecurringAgreementInput): Promise<RecurringAgreementResult> {
    void input;
    throw new BillingProviderError("BILLING_OPERATION_NOT_SUPPORTED");
  }

  async cancelRecurringAgreement(input: CancelRecurringAgreementInput): Promise<void> {
    void input;
    throw new BillingProviderError("BILLING_OPERATION_NOT_SUPPORTED");
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentResult> {
    void input;
    throw new BillingProviderError("BILLING_OPERATION_NOT_SUPPORTED");
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    void input;
    throw new BillingProviderError("BILLING_OPERATION_NOT_SUPPORTED");
  }

  async verifyWebhook(request: Request): Promise<VerifiedBillingEvent> {
    void request;
    throw new BillingProviderError("BILLING_OPERATION_NOT_SUPPORTED");
  }
}
