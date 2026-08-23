import "server-only";

import {
  PaymentProviderError,
  type PaymentEnvironment,
  type PaymentProviderAdapter,
  type PaymentProviderCode,
} from "./types";

export class ContractOnlyPaymentProviderAdapter implements PaymentProviderAdapter {
  constructor(
    readonly provider: PaymentProviderCode,
    readonly environment: Exclude<PaymentEnvironment, "MOCK">,
    private readonly blockerCode: string,
  ) {}

  private unavailable(): never {
    throw new PaymentProviderError(this.blockerCode, 503);
  }

  createPaymentSession(): never { return this.unavailable(); }
  queryPayment(): never { return this.unavailable(); }
  cancelPayment(): never { return this.unavailable(); }
  refundPayment(): never { return this.unavailable(); }
  verifyWebhook(): never { return this.unavailable(); }
  reconcile(): never { return this.unavailable(); }
}
