import "server-only";

import {
  InvoiceProviderError,
  type InvoiceAdapterContext,
  type InvoiceAllowanceInput,
  type InvoiceAllowanceLookupInput,
  type InvoiceEnvironment,
  type InvoiceIssueInput,
  type InvoiceLookupInput,
  type InvoiceProviderAdapter,
  type InvoiceProviderCapabilities,
  type InvoiceProviderCode,
  type InvoiceReconcileInput,
  type InvoiceVoidInput,
} from "./e-invoice-provider";

export class ContractOnlyInvoiceProviderAdapter implements InvoiceProviderAdapter {
  constructor(
    readonly provider: InvoiceProviderCode,
    readonly environment: Exclude<InvoiceEnvironment, "MOCK">,
    private readonly capabilities: InvoiceProviderCapabilities,
    private readonly blockerCode: string,
  ) {}

  getCapabilities() { return { ...this.capabilities }; }
  private unavailable(): never { throw new InvoiceProviderError(this.blockerCode, 503, false); }

  async validateConnection() { return { status: "BLOCKED" as const, responseCode: this.blockerCode, checkedAt: new Date() }; }
  issueInvoice(input: InvoiceIssueInput): never { void input; return this.unavailable(); }
  queryInvoice(input: InvoiceLookupInput): never { void input; return this.unavailable(); }
  voidInvoice(input: InvoiceVoidInput): never { void input; return this.unavailable(); }
  createAllowance(input: InvoiceAllowanceInput): never { void input; return this.unavailable(); }
  queryAllowance(input: InvoiceAllowanceLookupInput): never { void input; return this.unavailable(); }
  voidAllowance(input: InvoiceAllowanceLookupInput): never { void input; return this.unavailable(); }
  validateMobileBarcode(context: InvoiceAdapterContext, value: string): never { void context; void value; return this.unavailable(); }
  validateDonationCode(context: InvoiceAdapterContext, value: string): never { void context; void value; return this.unavailable(); }
  reconcileInvoice(input: InvoiceReconcileInput): never { void input; return this.unavailable(); }
  async healthCheck() { return { status: "BLOCKED" as const, responseCode: this.blockerCode, checkedAt: new Date() }; }
}
