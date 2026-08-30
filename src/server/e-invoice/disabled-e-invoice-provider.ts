import { ContractOnlyInvoiceProviderAdapter } from "./contract-only-adapter";
import { noInvoiceCapabilities } from "./e-invoice-provider";

export class DisabledElectronicInvoiceProvider extends ContractOnlyInvoiceProviderAdapter {
  constructor() {
    super(
      "ECPAY",
      "SANDBOX",
      { ...noInvoiceCapabilities },
      "E_INVOICE_PROVIDER_NOT_CONFIGURED",
    );
  }
}
