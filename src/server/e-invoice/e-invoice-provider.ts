import "server-only";

export const electronicInvoiceErrorCodes = [
  "E_INVOICE_PROVIDER_NOT_CONFIGURED",
  "INVALID_E_INVOICE_WEBHOOK",
] as const;

export type ElectronicInvoiceErrorCode = (typeof electronicInvoiceErrorCodes)[number];

export class ElectronicInvoiceProviderError extends Error {
  constructor(readonly code: ElectronicInvoiceErrorCode) {
    super(code);
    this.name = "ElectronicInvoiceProviderError";
  }
}

export type IssueTaxInvoiceInput = {
  organizationId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  taxId?: string;
  carrierType?: string;
  carrierValueHash?: string;
};

export type VoidTaxInvoiceInput = {
  taxDocumentId: string;
  reason: string;
};

export type CreateAllowanceInput = {
  taxDocumentId: string;
  amount: number;
  reason: string;
};

export type QueryTaxInvoiceInput = {
  taxDocumentId: string;
};

export type TaxInvoiceResult = {
  provider: string;
  taxDocumentId: string;
  providerDocumentId: string | null;
  status: "PENDING" | "ISSUED" | "VOIDED" | "FAILED";
};

export type VerifiedTaxInvoiceEvent = {
  provider: string;
  providerEventId: string;
  eventType: string;
  taxDocumentId: string;
  status: "ISSUED" | "VOIDED" | "FAILED";
  occurredAt: Date;
};

export interface ElectronicInvoiceProvider {
  issueInvoice(input: IssueTaxInvoiceInput): Promise<TaxInvoiceResult>;
  voidInvoice(input: VoidTaxInvoiceInput): Promise<TaxInvoiceResult>;
  createAllowance(input: CreateAllowanceInput): Promise<TaxInvoiceResult>;
  queryInvoice(input: QueryTaxInvoiceInput): Promise<TaxInvoiceResult>;
  verifyWebhook(request: Request): Promise<VerifiedTaxInvoiceEvent>;
}
