import "server-only";

import { createHash } from "node:crypto";
import {
  assertCapability,
  assertInvoiceTaxSnapshot,
  InvoiceProviderError,
  type InvoiceAdapterContext,
  type InvoiceAllowanceInput,
  type InvoiceAllowanceLookupInput,
  type InvoiceIssueInput,
  type InvoiceLifecycleStatus,
  type InvoiceLookupInput,
  type InvoiceOperationType,
  type InvoiceProviderAdapter,
  type InvoiceProviderCapabilities,
  type InvoiceProviderCode,
  type InvoiceProviderResult,
  type InvoiceReconcileInput,
  type InvoiceVoidInput,
} from "./e-invoice-provider";

type MockBehavior = Partial<Record<InvoiceOperationType, "TIMEOUT" | "PROVIDER_4XX" | "PROVIDER_5XX">>;

type StoredInvoice = {
  result: InvoiceProviderResult;
  totalAmount: number;
  taxAmount: number;
  allowedAmount: number;
};

type IdempotentResult = { fingerprint: string; result: InvoiceProviderResult };

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class MockInvoiceProviderAdapter implements InvoiceProviderAdapter {
  readonly environment = "MOCK" as const;
  private readonly invoices = new Map<string, StoredInvoice>();
  private readonly idempotency = new Map<string, IdempotentResult>();

  constructor(
    readonly provider: InvoiceProviderCode,
    private readonly capabilities: Readonly<InvoiceProviderCapabilities>,
    private readonly now: () => Date = () => new Date(),
    private readonly behavior: MockBehavior = {},
  ) {}

  getCapabilities() { return { ...this.capabilities }; }

  async validateConnection(context: InvoiceAdapterContext) {
    this.assertContext(context);
    this.maybeFail("QUERY");
    return { status: "HEALTHY" as const, responseCode: "MOCK_CONNECTION_VALID", checkedAt: this.now() };
  }

  async issueInvoice(input: InvoiceIssueInput) {
    this.assertContext(input);
    assertInvoiceTaxSnapshot(input.tax);
    assertCapability(this.capabilities, input.buyer.buyerType === "BUSINESS" ? "b2bIssue" : "b2cIssue");
    this.maybeFail("ISSUE");

    const stateKey = this.stateKey(input);
    const existingInvoice = this.invoices.get(stateKey);
    if (existingInvoice) return { ...existingInvoice.result, idempotentReplay: true };

    const fingerprint = sha256(JSON.stringify({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      documentId: input.invoiceDocumentId,
      orderReference: input.orderReference,
      sellerTaxId: input.seller.taxId,
      buyer: input.buyer,
      tax: input.tax,
    }));
    const replay = this.idempotentReplay(input, fingerprint);
    if (replay) return replay;

    const token = sha256(`${input.organizationId}:${input.connectionId}:${input.invoiceDocumentId}`).slice(0, 16).toUpperCase();
    const result: InvoiceProviderResult = {
      provider: this.provider,
      providerRequestId: `mock_req_${token.toLowerCase()}`,
      externalInvoiceNumber: `TEST-NOT-A-LEGAL-INVOICE-${token}`,
      externalRandomCode: null,
      externalAllowanceReference: null,
      status: "ISSUED",
      responseCode: "MOCK_ISSUED",
      idempotentReplay: false,
      occurredAt: this.now(),
    };
    this.invoices.set(stateKey, {
      result,
      totalAmount: input.tax.totalAmount,
      taxAmount: input.tax.taxAmount,
      allowedAmount: 0,
    });
    this.rememberIdempotency(input, fingerprint, result);
    return result;
  }

  async queryInvoice(input: InvoiceLookupInput) {
    this.assertContext(input);
    assertCapability(this.capabilities, "query");
    this.maybeFail("QUERY");
    return { ...this.requireInvoice(input).result, providerRequestId: this.requestId("query", input), responseCode: "MOCK_QUERY_OK" };
  }

  async voidInvoice(input: InvoiceVoidInput) {
    this.assertContext(input);
    assertCapability(this.capabilities, "void");
    this.maybeFail("VOID");
    if (!input.reason.trim()) throw new InvoiceProviderError("INVOICE_VOID_REASON_REQUIRED", 400);
    const stored = this.requireInvoice(input);
    if (stored.result.status === "VOIDED") return { ...stored.result, idempotentReplay: true };
    if (!(["ISSUED", "FULLY_ALLOWED"] as InvoiceLifecycleStatus[]).includes(stored.result.status)) {
      throw new InvoiceProviderError("INVOICE_VOID_STATE_INVALID");
    }
    stored.result = {
      ...stored.result,
      providerRequestId: this.requestId("void", input),
      status: "VOIDED",
      responseCode: "MOCK_VOIDED",
      occurredAt: this.now(),
      idempotentReplay: false,
    };
    return stored.result;
  }

  async createAllowance(input: InvoiceAllowanceInput) {
    this.assertContext(input);
    assertCapability(this.capabilities, "allowance");
    this.maybeFail("ALLOWANCE");
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || !input.reason.trim()) {
      throw new InvoiceProviderError("INVOICE_ALLOWANCE_INPUT_INVALID", 400);
    }
    const stored = this.requireInvoice(input);
    if (!["ISSUED", "PARTIALLY_ALLOWED"].includes(stored.result.status)) {
      throw new InvoiceProviderError("INVOICE_ALLOWANCE_STATE_INVALID");
    }
    if (stored.allowedAmount + input.amount > stored.totalAmount) {
      throw new InvoiceProviderError("INVOICE_ALLOWANCE_AMOUNT_EXCEEDS_TOTAL", 400);
    }
    stored.allowedAmount += input.amount;
    const status = stored.allowedAmount === stored.totalAmount ? "FULLY_ALLOWED" as const : "PARTIALLY_ALLOWED" as const;
    const allowanceReference = `TEST-ALLOWANCE-${sha256(`${input.invoiceDocumentId}:${stored.allowedAmount}`).slice(0, 16).toUpperCase()}`;
    stored.result = {
      ...stored.result,
      providerRequestId: this.requestId("allowance", input),
      externalAllowanceReference: allowanceReference,
      status,
      responseCode: `MOCK_${status}`,
      occurredAt: this.now(),
      idempotentReplay: false,
    };
    return stored.result;
  }

  async queryAllowance(input: InvoiceAllowanceLookupInput) {
    this.assertContext(input);
    assertCapability(this.capabilities, "allowance");
    this.maybeFail("QUERY");
    const stored = this.requireInvoice(input);
    if (!stored.result.externalAllowanceReference) throw new InvoiceProviderError("INVOICE_ALLOWANCE_NOT_FOUND", 404);
    return { ...stored.result, providerRequestId: this.requestId("allowance_query", input), responseCode: "MOCK_ALLOWANCE_QUERY_OK" };
  }

  async voidAllowance(input: InvoiceAllowanceLookupInput) {
    this.assertContext(input);
    assertCapability(this.capabilities, "allowanceVoid");
    this.maybeFail("ALLOWANCE_VOID");
    const stored = this.requireInvoice(input);
    if (!stored.result.externalAllowanceReference) throw new InvoiceProviderError("INVOICE_ALLOWANCE_NOT_FOUND", 404);
    stored.allowedAmount = 0;
    stored.result = {
      ...stored.result,
      providerRequestId: this.requestId("allowance_void", input),
      externalAllowanceReference: null,
      status: "ALLOWANCE_VOIDED",
      responseCode: "MOCK_ALLOWANCE_VOIDED",
      occurredAt: this.now(),
      idempotentReplay: false,
    };
    return stored.result;
  }

  async validateMobileBarcode(context: InvoiceAdapterContext, value: string) {
    this.assertContext(context);
    assertCapability(this.capabilities, "mobileBarcode");
    this.maybeFail("CARRIER_VALIDATE");
    const normalized = value.trim().toUpperCase();
    const valid = /^\/[0-9A-Z.+-]{7}$/.test(normalized);
    return { valid, normalizedHash: valid ? sha256(normalized) : null, responseCode: valid ? "MOCK_CARRIER_VALID" : "MOCK_CARRIER_INVALID" };
  }

  async validateDonationCode(context: InvoiceAdapterContext, value: string) {
    this.assertContext(context);
    assertCapability(this.capabilities, "donationCode");
    this.maybeFail("DONATION_VALIDATE");
    const normalized = value.trim();
    const valid = /^\d{3,7}$/.test(normalized);
    return { valid, normalizedHash: valid ? sha256(normalized) : null, responseCode: valid ? "MOCK_DONATION_VALID" : "MOCK_DONATION_INVALID" };
  }

  async reconcileInvoice(input: InvoiceReconcileInput) {
    this.assertContext(input);
    assertCapability(this.capabilities, "reconciliation");
    this.maybeFail("RECONCILE");
    const stored = this.requireInvoice(input);
    const mismatchCodes = [
      stored.result.status !== input.expectedStatus ? "STATUS_MISMATCH" : null,
      stored.totalAmount !== input.expectedTotalAmount ? "AMOUNT_MISMATCH" : null,
      stored.taxAmount !== input.expectedTaxAmount ? "TAX_MISMATCH" : null,
    ].filter((code): code is string => Boolean(code));
    return {
      outcome: mismatchCodes.length ? "MISMATCH" as const : "MATCHED" as const,
      providerStatus: stored.result.status,
      providerTotalAmount: stored.totalAmount,
      providerTaxAmount: stored.taxAmount,
      mismatchCodes,
    };
  }

  async healthCheck(context: InvoiceAdapterContext) {
    this.assertContext(context);
    return { status: "HEALTHY" as const, responseCode: "MOCK_HEALTHY", checkedAt: this.now() };
  }

  restoreLocalState(input: InvoiceAdapterContext & {
    invoiceDocumentId: string;
    externalInvoiceNumber: string;
    externalAllowanceReference: string | null;
    status: InvoiceLifecycleStatus;
    totalAmount: number;
    taxAmount: number;
    allowedAmount: number;
  }) {
    this.assertContext(input);
    const key = this.stateKey(input);
    if (this.invoices.has(key)) return;
    this.invoices.set(key, {
      result: {
        provider: this.provider,
        providerRequestId: `mock_restore_${sha256(key).slice(0, 20)}`,
        externalInvoiceNumber: input.externalInvoiceNumber,
        externalRandomCode: null,
        externalAllowanceReference: input.externalAllowanceReference,
        status: input.status,
        responseCode: "MOCK_STATE_RESTORED",
        idempotentReplay: true,
        occurredAt: this.now(),
      },
      totalAmount: input.totalAmount,
      taxAmount: input.taxAmount,
      allowedAmount: input.allowedAmount,
    });
  }

  private assertContext(context: InvoiceAdapterContext) {
    if (context.environment !== "MOCK" || !context.organizationId || !context.connectionId || !context.correlationId) {
      throw new InvoiceProviderError("INVOICE_MOCK_CONTEXT_INVALID", 400);
    }
  }

  private stateKey(input: Pick<InvoiceLookupInput, "organizationId" | "connectionId" | "invoiceDocumentId">) {
    return `${input.organizationId}:${input.connectionId}:${input.invoiceDocumentId}`;
  }

  private requireInvoice(input: InvoiceLookupInput) {
    const stored = this.invoices.get(this.stateKey(input));
    if (!stored || stored.result.externalInvoiceNumber !== input.externalInvoiceNumber) {
      throw new InvoiceProviderError("INVOICE_DOCUMENT_NOT_FOUND", 404);
    }
    return stored;
  }

  private requestId(operation: string, input: InvoiceLookupInput) {
    return `mock_req_${sha256(`${operation}:${input.organizationId}:${input.invoiceDocumentId}:${input.idempotencyKey}`).slice(0, 24)}`;
  }

  private idempotentReplay(input: InvoiceIssueInput, fingerprint: string) {
    const existing = this.idempotency.get(`${input.organizationId}:${input.connectionId}:${input.idempotencyKey}`);
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) throw new InvoiceProviderError("INVOICE_IDEMPOTENCY_CONFLICT");
    return { ...existing.result, idempotentReplay: true };
  }

  private rememberIdempotency(input: InvoiceIssueInput, fingerprint: string, result: InvoiceProviderResult) {
    this.idempotency.set(`${input.organizationId}:${input.connectionId}:${input.idempotencyKey}`, { fingerprint, result });
  }

  private maybeFail(operation: InvoiceOperationType) {
    const behavior = this.behavior[operation];
    if (!behavior) return;
    delete this.behavior[operation];
    if (behavior === "TIMEOUT") throw new InvoiceProviderError("INVOICE_PROVIDER_TIMEOUT", 504, true);
    if (behavior === "PROVIDER_5XX") throw new InvoiceProviderError("INVOICE_PROVIDER_UNAVAILABLE", 503, true);
    throw new InvoiceProviderError("INVOICE_PROVIDER_REJECTED", 422, false);
  }
}

export { MockInvoiceProviderAdapter as MockElectronicInvoiceProvider };
