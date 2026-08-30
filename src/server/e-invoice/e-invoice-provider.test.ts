import { describe, expect, it } from "vitest";
import { DisabledElectronicInvoiceProvider } from "./disabled-e-invoice-provider";
import { MockElectronicInvoiceProvider } from "./mock-e-invoice-provider";
import { getInvoiceProviderDefinition } from "./provider-definitions";
import type { InvoiceIssueInput } from "./e-invoice-provider";

const now = new Date("2026-08-30T00:00:00.000Z");
const issueInput: InvoiceIssueInput = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222",
  environment: "MOCK",
  correlationId: "correlation-1",
  invoiceDocumentId: "33333333-3333-4333-8333-333333333333",
  orderReference: "TEST-ORDER-1",
  idempotencyKey: "issue-1",
  seller: {
    legalName: "TEST SELLER / NOT LEGAL",
    taxId: "TEST-ONLY",
    registeredAddress: "TEST ONLY",
  },
  buyer: { buyerType: "CLOUD" },
  tax: {
    salesAmount: 699,
    taxAmount: 0,
    totalAmount: 699,
    taxType: "MOCK_NOT_TAX_DETERMINED",
    roundingPolicy: "TEST_ONLY",
    currency: "TWD",
  },
};

describe("electronic invoice providers", () => {
  it("keeps every non-mock provider fail-closed", async () => {
    const provider = new DisabledElectronicInvoiceProvider();
    await expect(Promise.resolve().then(() => provider.issueInvoice({
      ...issueInput,
      environment: "SANDBOX",
    }))).rejects.toMatchObject({ code: "E_INVOICE_PROVIDER_NOT_CONFIGURED" });
  });

  it("issues a clearly non-legal deterministic mock and replays idempotently", async () => {
    const provider = new MockElectronicInvoiceProvider(
      "ECPAY",
      { ...getInvoiceProviderDefinition("ECPAY").mockCapabilities },
      () => now,
    );
    const issued = await provider.issueInvoice(issueInput);
    const replay = await provider.issueInvoice(issueInput);

    expect(issued).toMatchObject({
      provider: "ECPAY",
      status: "ISSUED",
      responseCode: "MOCK_ISSUED",
      occurredAt: now,
      idempotentReplay: false,
    });
    expect(issued.externalInvoiceNumber).toMatch(/^TEST-NOT-A-LEGAL-INVOICE-/);
    expect(replay).toMatchObject({
      externalInvoiceNumber: issued.externalInvoiceNumber,
      idempotentReplay: true,
    });
  });

  it("isolates mock state by organization and connection", async () => {
    const provider = new MockElectronicInvoiceProvider(
      "ECPAY",
      { ...getInvoiceProviderDefinition("ECPAY").mockCapabilities },
      () => now,
    );
    const issued = await provider.issueInvoice(issueInput);
    await expect(provider.queryInvoice({
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      connectionId: issueInput.connectionId,
      environment: "MOCK",
      correlationId: "correlation-2",
      invoiceDocumentId: issueInput.invoiceDocumentId,
      externalInvoiceNumber: issued.externalInvoiceNumber,
      idempotencyKey: "query-1",
    })).rejects.toMatchObject({ code: "INVOICE_DOCUMENT_NOT_FOUND" });
  });

  it("supports allowance and allowance void without changing the order total", async () => {
    const provider = new MockElectronicInvoiceProvider(
      "EZPAY",
      { ...getInvoiceProviderDefinition("EZPAY").mockCapabilities },
      () => now,
    );
    const issued = await provider.issueInvoice({ ...issueInput, idempotencyKey: "issue-allowance" });
    const lookup = {
      organizationId: issueInput.organizationId,
      connectionId: issueInput.connectionId,
      environment: "MOCK" as const,
      correlationId: "correlation-allowance",
      invoiceDocumentId: issueInput.invoiceDocumentId,
      externalInvoiceNumber: issued.externalInvoiceNumber,
      idempotencyKey: "allowance-1",
    };
    const allowed = await provider.createAllowance({ ...lookup, amount: 100, reason: "TEST" });
    expect(allowed.status).toBe("PARTIALLY_ALLOWED");
    expect(allowed.externalAllowanceReference).toMatch(/^TEST-ALLOWANCE-/);
    const voided = await provider.voidAllowance({
      ...lookup,
      idempotencyKey: "allowance-void-1",
      externalAllowanceReference: allowed.externalAllowanceReference!,
    });
    expect(voided).toMatchObject({ status: "ALLOWANCE_VOIDED", externalAllowanceReference: null });
  });

  it.each([
    ["TIMEOUT", "INVOICE_PROVIDER_TIMEOUT", true],
    ["PROVIDER_4XX", "INVOICE_PROVIDER_REJECTED", false],
    ["PROVIDER_5XX", "INVOICE_PROVIDER_UNAVAILABLE", true],
  ] as const)("classifies injected %s failures", async (behavior, code, retryable) => {
    const provider = new MockElectronicInvoiceProvider(
      "ECPAY",
      { ...getInvoiceProviderDefinition("ECPAY").mockCapabilities },
      () => now,
      { ISSUE: behavior },
    );

    await expect(provider.issueInvoice({ ...issueInput, idempotencyKey: `issue-${behavior}` }))
      .rejects.toMatchObject({ code, retryable });
  });

  it("rejects an operation when the selected provider capability is unavailable", async () => {
    const provider = new MockElectronicInvoiceProvider(
      "ECPAY",
      { ...getInvoiceProviderDefinition("ECPAY").mockCapabilities, b2cIssue: false },
      () => now,
    );

    await expect(provider.issueInvoice({ ...issueInput, idempotencyKey: "issue-unsupported" }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY", retryable: false });
  });
});
