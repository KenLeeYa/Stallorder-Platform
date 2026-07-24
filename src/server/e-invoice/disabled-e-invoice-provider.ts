import {
  ElectronicInvoiceProviderError,
  type CreateAllowanceInput,
  type ElectronicInvoiceProvider,
  type IssueTaxInvoiceInput,
  type QueryTaxInvoiceInput,
  type TaxInvoiceResult,
  type VerifiedTaxInvoiceEvent,
  type VoidTaxInvoiceInput,
} from "./e-invoice-provider";

export class DisabledElectronicInvoiceProvider implements ElectronicInvoiceProvider {
  private unavailable(): never {
    throw new ElectronicInvoiceProviderError("E_INVOICE_PROVIDER_NOT_CONFIGURED");
  }

  async issueInvoice(input: IssueTaxInvoiceInput): Promise<TaxInvoiceResult> {
    void input;
    return this.unavailable();
  }

  async voidInvoice(input: VoidTaxInvoiceInput): Promise<TaxInvoiceResult> {
    void input;
    return this.unavailable();
  }

  async createAllowance(input: CreateAllowanceInput): Promise<TaxInvoiceResult> {
    void input;
    return this.unavailable();
  }

  async queryInvoice(input: QueryTaxInvoiceInput): Promise<TaxInvoiceResult> {
    void input;
    return this.unavailable();
  }

  async verifyWebhook(request: Request): Promise<VerifiedTaxInvoiceEvent> {
    void request;
    return this.unavailable();
  }
}
