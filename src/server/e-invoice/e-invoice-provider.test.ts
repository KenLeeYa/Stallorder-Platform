import { describe, expect, it } from "vitest";
import { DisabledElectronicInvoiceProvider } from "./disabled-e-invoice-provider";
import { MockElectronicInvoiceProvider } from "./mock-e-invoice-provider";

describe("electronic invoice providers", () => {
  it("keeps the production provider disabled", async () => {
    await expect(new DisabledElectronicInvoiceProvider().issueInvoice({
      organizationId: "organization-1",
      invoiceId: "invoice-1",
      amount: 699,
      currency: "TWD",
    })).rejects.toMatchObject({ code: "E_INVOICE_PROVIDER_NOT_CONFIGURED" });
  });

  it("provides a deterministic test-only mock", async () => {
    const result = await new MockElectronicInvoiceProvider().issueInvoice({
      organizationId: "organization-1",
      invoiceId: "invoice-1",
      amount: 699,
      currency: "TWD",
    });
    expect(result).toEqual({
      provider: "MOCK",
      taxDocumentId: "invoice-1",
      providerDocumentId: "mock:invoice-1",
      status: "ISSUED",
    });
  });
});
