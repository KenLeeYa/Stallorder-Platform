import "server-only";

export const invoiceProviderCodes = ["ECPAY", "EZPAY", "TRADEVAN", "CUSTOM"] as const;
export type InvoiceProviderCode = (typeof invoiceProviderCodes)[number];

export const invoiceEnvironments = ["MOCK", "SANDBOX", "PRODUCTION"] as const;
export type InvoiceEnvironment = (typeof invoiceEnvironments)[number];

export const invoiceLifecycleStatuses = [
  "NOT_REQUIRED", "PENDING", "ISSUING", "ISSUED", "ISSUE_FAILED",
  "VOID_PENDING", "VOIDED", "VOID_FAILED",
  "ALLOWANCE_PENDING", "PARTIALLY_ALLOWED", "FULLY_ALLOWED", "ALLOWANCE_FAILED",
  "ALLOWANCE_VOID_PENDING", "ALLOWANCE_VOIDED", "ALLOWANCE_VOID_FAILED",
  "RECONCILIATION_REQUIRED", "MANUAL_REVIEW",
] as const;
export type InvoiceLifecycleStatus = (typeof invoiceLifecycleStatuses)[number];

export const invoiceOperationTypes = [
  "ISSUE", "QUERY", "VOID", "ALLOWANCE", "ALLOWANCE_VOID",
  "CARRIER_VALIDATE", "DONATION_VALIDATE", "RECONCILE",
] as const;
export type InvoiceOperationType = (typeof invoiceOperationTypes)[number];

export type InvoiceProviderCapabilities = {
  b2cIssue: boolean;
  b2bIssue: boolean;
  query: boolean;
  void: boolean;
  allowance: boolean;
  allowanceVoid: boolean;
  mobileBarcode: boolean;
  citizenDigitalCertificate: boolean;
  memberCarrier: boolean;
  donationCode: boolean;
  paperProof: boolean;
  emailNotification: boolean;
  smsNotification: boolean;
  offlineIssue: boolean;
  invoiceTrackManagement: boolean;
  batchIssue: boolean;
  webhook: boolean;
  reconciliation: boolean;
  sandbox: boolean;
};

export const noInvoiceCapabilities: Readonly<InvoiceProviderCapabilities> = Object.freeze({
  b2cIssue: false,
  b2bIssue: false,
  query: false,
  void: false,
  allowance: false,
  allowanceVoid: false,
  mobileBarcode: false,
  citizenDigitalCertificate: false,
  memberCarrier: false,
  donationCode: false,
  paperProof: false,
  emailNotification: false,
  smsNotification: false,
  offlineIssue: false,
  invoiceTrackManagement: false,
  batchIssue: false,
  webhook: false,
  reconciliation: false,
  sandbox: false,
});

export type InvoiceAdapterContext = {
  organizationId: string;
  connectionId: string;
  environment: InvoiceEnvironment;
  correlationId: string;
};

export type InvoiceTaxSnapshot = {
  salesAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxType: string;
  roundingPolicy: string;
  currency: "TWD";
};

export type InvoiceSellerSnapshot = {
  legalName: string;
  taxId: string;
  registeredAddress: string;
};

export type InvoiceBuyerSnapshot = {
  buyerType: "CLOUD" | "MOBILE_BARCODE" | "MEMBER_CARRIER" | "BUSINESS" | "DONATION" | "PAPER";
  buyerTaxId?: string;
  buyerName?: string;
  carrierType?: "MOBILE_BARCODE" | "MEMBER";
  carrierValue?: string;
  donationCode?: string;
};

export type InvoiceIssueInput = InvoiceAdapterContext & {
  invoiceDocumentId: string;
  orderReference: string;
  idempotencyKey: string;
  seller: InvoiceSellerSnapshot;
  buyer: InvoiceBuyerSnapshot;
  tax: InvoiceTaxSnapshot;
};

export type InvoiceLookupInput = InvoiceAdapterContext & {
  invoiceDocumentId: string;
  externalInvoiceNumber: string;
  idempotencyKey: string;
};

export type InvoiceVoidInput = InvoiceLookupInput & { reason: string };
export type InvoiceAllowanceInput = InvoiceLookupInput & { amount: number; reason: string };
export type InvoiceAllowanceLookupInput = InvoiceLookupInput & { externalAllowanceReference: string };

export type InvoiceReconcileInput = InvoiceLookupInput & {
  expectedStatus: InvoiceLifecycleStatus;
  expectedTotalAmount: number;
  expectedTaxAmount: number;
};

export type InvoiceProviderResult = {
  provider: InvoiceProviderCode;
  providerRequestId: string;
  externalInvoiceNumber: string;
  externalRandomCode: string | null;
  externalAllowanceReference: string | null;
  status: InvoiceLifecycleStatus;
  responseCode: string;
  idempotentReplay: boolean;
  occurredAt: Date;
};

export type InvoiceValidationResult = {
  valid: boolean;
  normalizedHash: string | null;
  responseCode: string;
};

export type InvoiceReconciliationResult = {
  outcome: "MATCHED" | "MISMATCH";
  providerStatus: InvoiceLifecycleStatus;
  providerTotalAmount: number;
  providerTaxAmount: number;
  mismatchCodes: string[];
};

export type InvoiceProviderHealth = {
  status: "HEALTHY" | "DEGRADED" | "BLOCKED";
  responseCode: string;
  checkedAt: Date;
};

export interface InvoiceProviderAdapter {
  readonly provider: InvoiceProviderCode;
  readonly environment: InvoiceEnvironment;
  validateConnection(context: InvoiceAdapterContext): Promise<InvoiceProviderHealth>;
  getCapabilities(): InvoiceProviderCapabilities;
  issueInvoice(input: InvoiceIssueInput): Promise<InvoiceProviderResult>;
  queryInvoice(input: InvoiceLookupInput): Promise<InvoiceProviderResult>;
  voidInvoice(input: InvoiceVoidInput): Promise<InvoiceProviderResult>;
  createAllowance(input: InvoiceAllowanceInput): Promise<InvoiceProviderResult>;
  queryAllowance(input: InvoiceAllowanceLookupInput): Promise<InvoiceProviderResult>;
  voidAllowance(input: InvoiceAllowanceLookupInput): Promise<InvoiceProviderResult>;
  validateMobileBarcode(context: InvoiceAdapterContext, value: string): Promise<InvoiceValidationResult>;
  validateDonationCode(context: InvoiceAdapterContext, value: string): Promise<InvoiceValidationResult>;
  reconcileInvoice(input: InvoiceReconcileInput): Promise<InvoiceReconciliationResult>;
  healthCheck(context: InvoiceAdapterContext): Promise<InvoiceProviderHealth>;
}

export class InvoiceProviderError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "InvoiceProviderError";
  }
}

export function assertInvoiceTaxSnapshot(value: InvoiceTaxSnapshot) {
  if (
    value.currency !== "TWD"
    || !Number.isSafeInteger(value.salesAmount)
    || !Number.isSafeInteger(value.taxAmount)
    || !Number.isSafeInteger(value.totalAmount)
    || value.salesAmount < 0
    || value.taxAmount < 0
    || value.totalAmount <= 0
    || value.salesAmount + value.taxAmount !== value.totalAmount
  ) {
    throw new InvoiceProviderError("INVOICE_TAX_SNAPSHOT_INVALID", 400);
  }
}

export function assertCapability(
  capabilities: InvoiceProviderCapabilities,
  capability: keyof InvoiceProviderCapabilities,
) {
  if (!capabilities[capability]) throw new InvoiceProviderError("UNSUPPORTED_CAPABILITY", 422);
}

// Earlier commercial-billing scaffold compatibility aliases.
export type IssueTaxInvoiceInput = InvoiceIssueInput;
export type VoidTaxInvoiceInput = InvoiceVoidInput;
export type CreateAllowanceInput = InvoiceAllowanceInput;
export type QueryTaxInvoiceInput = InvoiceLookupInput;
export type TaxInvoiceResult = InvoiceProviderResult;
export type ElectronicInvoiceProvider = InvoiceProviderAdapter;
export { InvoiceProviderError as ElectronicInvoiceProviderError };
