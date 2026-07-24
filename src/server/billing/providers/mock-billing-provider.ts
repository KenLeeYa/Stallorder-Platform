import {
  BillingProviderError,
  type BillingCustomerResult,
  type BillingProvider,
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

type MockWebhookBody = Omit<VerifiedBillingEvent, "provider" | "occurredAt"> & {
  occurredAt: string;
};

export class MockBillingProvider implements BillingProvider {
  readonly code = "MOCK";

  constructor() {
    if (process.env.NODE_ENV !== "test") {
      throw new BillingProviderError("BILLING_PROVIDER_NOT_CONFIGURED");
    }
  }

  async createCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomerResult> {
    return { provider: this.code, providerCustomerId: `mock:${input.organizationId}`, status: "ACTIVE" };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    return {
      provider: this.code,
      providerTransactionId: `mock:${input.invoiceId}`,
      status: "PENDING",
      redirectUrl: null,
    };
  }

  async createRecurringAgreement(input: CreateRecurringAgreementInput): Promise<RecurringAgreementResult> {
    return {
      provider: this.code,
      providerAgreementId: `mock:${input.organizationId}:${input.planVersionId}`,
      status: "ACTIVE",
    };
  }

  async cancelRecurringAgreement(): Promise<void> {
    return;
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentResult> {
    return {
      provider: this.code,
      providerTransactionId: input.providerTransactionId,
      invoiceId: input.invoiceId,
      amount: 100,
      currency: "TWD",
      status: "SUCCEEDED",
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    return {
      provider: this.code,
      providerTransactionId: input.providerTransactionId,
      status: "REFUNDED",
    };
  }

  async verifyWebhook(request: Request): Promise<VerifiedBillingEvent> {
    if (request.headers.get("x-mock-signature") !== "valid-test-signature") {
      throw new BillingProviderError("INVALID_WEBHOOK_SIGNATURE");
    }
    const body = await request.json().catch(() => null) as MockWebhookBody | null;
    if (!isMockWebhookBody(body)) throw new BillingProviderError("INVALID_WEBHOOK_EVENT");
    return { ...body, provider: this.code, occurredAt: new Date(body.occurredAt) };
  }
}

function isMockWebhookBody(value: MockWebhookBody | null): value is MockWebhookBody {
  return Boolean(
    value
      && typeof value.providerEventId === "string"
      && typeof value.eventType === "string"
      && typeof value.providerTransactionId === "string"
      && typeof value.invoiceId === "string"
      && Number.isInteger(value.amount)
      && value.amount > 0
      && typeof value.currency === "string"
      && /^[A-Z]{3}$/.test(value.currency)
      && typeof value.occurredAt === "string"
      && !Number.isNaN(Date.parse(value.occurredAt)),
  );
}
