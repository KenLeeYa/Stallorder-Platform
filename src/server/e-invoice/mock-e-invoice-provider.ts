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

type MockTaxWebhookBody = Omit<VerifiedTaxInvoiceEvent, "provider" | "occurredAt"> & {
  occurredAt: string;
};

export class MockElectronicInvoiceProvider implements ElectronicInvoiceProvider {
  constructor() {
    if (process.env.NODE_ENV !== "test") {
      throw new ElectronicInvoiceProviderError("E_INVOICE_PROVIDER_NOT_CONFIGURED");
    }
  }

  async issueInvoice(input: IssueTaxInvoiceInput): Promise<TaxInvoiceResult> {
    return {
      provider: "MOCK",
      taxDocumentId: input.invoiceId,
      providerDocumentId: `mock:${input.invoiceId}`,
      status: "ISSUED",
    };
  }

  async voidInvoice(input: VoidTaxInvoiceInput): Promise<TaxInvoiceResult> {
    return { provider: "MOCK", taxDocumentId: input.taxDocumentId, providerDocumentId: null, status: "VOIDED" };
  }

  async createAllowance(input: CreateAllowanceInput): Promise<TaxInvoiceResult> {
    return { provider: "MOCK", taxDocumentId: input.taxDocumentId, providerDocumentId: null, status: "PENDING" };
  }

  async queryInvoice(input: QueryTaxInvoiceInput): Promise<TaxInvoiceResult> {
    return { provider: "MOCK", taxDocumentId: input.taxDocumentId, providerDocumentId: null, status: "ISSUED" };
  }

  async verifyWebhook(request: Request): Promise<VerifiedTaxInvoiceEvent> {
    if (request.headers.get("x-mock-signature") !== "valid-test-signature") {
      throw new ElectronicInvoiceProviderError("INVALID_E_INVOICE_WEBHOOK");
    }
    const body = await request.json().catch(() => null) as MockTaxWebhookBody | null;
    if (!isMockTaxWebhookBody(body)) {
      throw new ElectronicInvoiceProviderError("INVALID_E_INVOICE_WEBHOOK");
    }
    return { ...body, provider: "MOCK", occurredAt: new Date(body.occurredAt) };
  }
}

function isMockTaxWebhookBody(value: MockTaxWebhookBody | null): value is MockTaxWebhookBody {
  return Boolean(
    value
      && typeof value.providerEventId === "string"
      && typeof value.eventType === "string"
      && typeof value.taxDocumentId === "string"
      && ["ISSUED", "VOIDED", "FAILED"].includes(value.status)
      && typeof value.occurredAt === "string"
      && !Number.isNaN(Date.parse(value.occurredAt)),
  );
}
