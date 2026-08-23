import "server-only";

import { getPaymentProviderDefinition } from "./provider-definitions";
import { ContractOnlyPaymentProviderAdapter } from "./contract-only-adapter";
import { MockPaymentProviderAdapter } from "./mock-adapter";
import { assertPaymentMockEnvironment } from "./runtime-policy";
import type { PaymentEnvironment, PaymentProviderCode } from "./types";

const mockAdapters = new Map<PaymentProviderCode, MockPaymentProviderAdapter>();

export function getPaymentProviderAdapter(input: {
  provider: PaymentProviderCode;
  environment: PaymentEnvironment;
  mockSecret?: string;
}) {
  if (input.environment === "MOCK") {
    assertPaymentMockEnvironment();
    const existing = mockAdapters.get(input.provider);
    if (existing) return existing;
    const adapter = new MockPaymentProviderAdapter(
      input.provider,
      input.mockSecret?.trim()
        || process.env.PAYMENT_MOCK_WEBHOOK_SECRET?.trim()
        || "local-only-payment-mock-secret-32-characters-minimum",
    );
    mockAdapters.set(input.provider, adapter);
    return adapter;
  }

  const definition = getPaymentProviderDefinition(input.provider);
  return new ContractOnlyPaymentProviderAdapter(
    input.provider,
    input.environment,
    definition.liveBlocker ?? "PAYMENT_PROVIDER_LIVE_NOT_CONFIGURED",
  );
}
