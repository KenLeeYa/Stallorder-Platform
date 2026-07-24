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

export abstract class DisabledBillingProvider implements BillingProvider {
  abstract readonly code: string;

  private unavailable(): never {
    throw new BillingProviderError("BILLING_PROVIDER_NOT_CONFIGURED");
  }

  async createCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomerResult> {
    void input;
    return this.unavailable();
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    void input;
    return this.unavailable();
  }

  async createRecurringAgreement(input: CreateRecurringAgreementInput): Promise<RecurringAgreementResult> {
    void input;
    return this.unavailable();
  }

  async cancelRecurringAgreement(input: CancelRecurringAgreementInput): Promise<void> {
    void input;
    return this.unavailable();
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentResult> {
    void input;
    return this.unavailable();
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    void input;
    return this.unavailable();
  }

  async verifyWebhook(request: Request): Promise<VerifiedBillingEvent> {
    void request;
    return this.unavailable();
  }
}
