export const paymentProviderCodes = [
  "CASH_MANUAL",
  "LINE_PAY",
  "JKO_PAY",
  "TWQR",
  "TAIWAN_PAY",
  "PX_PAY_PLUS",
  "IPASS_MONEY",
  "ICASH_PAY",
  "PLUS_PAY",
  "EASY_WALLET",
  "GAMA_PAY",
  "OPAY",
  "PAYMENT_GATEWAY",
] as const;

export type PaymentProviderCode = (typeof paymentProviderCodes)[number];

export const canonicalPaymentStatuses = [
  "CREATED",
  "PENDING",
  "REQUIRES_CUSTOMER_ACTION",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "RECONCILIATION_REQUIRED",
] as const;

export type CanonicalPaymentStatus = (typeof canonicalPaymentStatuses)[number];
export type PaymentEnvironment = "MOCK" | "SANDBOX" | "LIVE";
export type PaymentConnectionMode = "DIRECT" | "TWQR" | "GATEWAY" | "MANUAL";
export type MockPaymentScenario = "SUCCESS" | "PENDING" | "FAILED" | "EXPIRED";

export type CreatePaymentInput = {
  merchantOrderId: string;
  amount: number;
  currency: "TWD";
  idempotencyKey: string;
  returnUrl: string;
  cancelUrl: string;
  mockScenario?: MockPaymentScenario;
};

export type CreatePaymentResult = {
  providerTransactionId: string;
  status: CanonicalPaymentStatus;
  providerStatus: string;
  customerActionUrl: string | null;
  expiresAt: string | null;
  idempotentReplay: boolean;
};

export type QueryPaymentInput = { providerTransactionId: string };
export type QueryPaymentResult = Omit<CreatePaymentResult, "customerActionUrl" | "idempotentReplay">;
export type CancelPaymentInput = QueryPaymentInput & { idempotencyKey: string };
export type CancelPaymentResult = QueryPaymentResult & { idempotentReplay: boolean };
export type RefundPaymentInput = QueryPaymentInput & {
  amount: number;
  currency: "TWD";
  reason: string;
  idempotencyKey: string;
};
export type RefundPaymentResult = {
  providerRefundId: string;
  providerTransactionId: string;
  refundedAmount: number;
  status: "PARTIALLY_REFUNDED" | "REFUNDED";
  providerStatus: string;
  idempotentReplay: boolean;
};
export type VerifyWebhookInput = {
  rawBody: string;
  signature: string;
  receivedAt: Date;
};
export type VerifiedWebhook = {
  provider: PaymentProviderCode;
  externalEventId: string;
  providerTransactionId: string;
  status: CanonicalPaymentStatus;
  providerStatus: string;
  amount: number;
  currency: "TWD";
  occurredAt: string;
  bodyHash: string;
  duplicate: boolean;
};
export type ReconcileInput = QueryPaymentInput & {
  expectedAmount: number;
  expectedCurrency: "TWD";
  expectedStatus: CanonicalPaymentStatus;
};
export type ReconciliationResult = {
  providerTransactionId: string;
  outcome: "MATCHED" | "MISMATCH";
  mismatchCodes: string[];
  providerStatus: CanonicalPaymentStatus;
};

export interface PaymentProviderAdapter {
  readonly provider: PaymentProviderCode;
  readonly environment: PaymentEnvironment;
  createPaymentSession(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  queryPayment(input: QueryPaymentInput): Promise<QueryPaymentResult>;
  cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook>;
  reconcile(input: ReconcileInput): Promise<ReconciliationResult>;
}

export class PaymentProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 409,
  ) {
    super(code);
  }
}

export function assertTwdAmount(amount: number, currency: string): asserts currency is "TWD" {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000) {
    throw new PaymentProviderError("PAYMENT_AMOUNT_INVALID", 400);
  }
  if (currency !== "TWD") throw new PaymentProviderError("PAYMENT_CURRENCY_UNSUPPORTED", 400);
}
