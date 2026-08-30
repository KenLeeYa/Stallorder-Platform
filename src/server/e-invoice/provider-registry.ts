import "server-only";

import { ContractOnlyInvoiceProviderAdapter } from "./contract-only-adapter";
import type { InvoiceEnvironment, InvoiceProviderCode } from "./e-invoice-provider";
import { MockInvoiceProviderAdapter } from "./mock-e-invoice-provider";
import { getInvoiceProviderDefinition } from "./provider-definitions";
import { assertInvoiceMockEnvironment, assertInvoiceProductionIssueDisabled } from "./runtime-policy";

const mockAdapters = new Map<string, MockInvoiceProviderAdapter>();

export function getInvoiceProviderAdapter(input: {
  provider: InvoiceProviderCode;
  environment: InvoiceEnvironment;
}) {
  const definition = getInvoiceProviderDefinition(input.provider);
  if (input.environment === "MOCK") {
    assertInvoiceMockEnvironment();
    if (input.provider === "CUSTOM") {
      return new ContractOnlyInvoiceProviderAdapter(
        "CUSTOM",
        "SANDBOX",
        { ...definition.liveCapabilities },
        definition.liveBlocker,
      );
    }
    const key = `${input.provider}:MOCK`;
    const existing = mockAdapters.get(key);
    if (existing) return existing;
    const adapter = new MockInvoiceProviderAdapter(input.provider, definition.mockCapabilities);
    mockAdapters.set(key, adapter);
    return adapter;
  }
  if (input.environment === "PRODUCTION") assertInvoiceProductionIssueDisabled();
  return new ContractOnlyInvoiceProviderAdapter(
    input.provider,
    input.environment,
    { ...definition.liveCapabilities },
    definition.liveBlocker,
  );
}
