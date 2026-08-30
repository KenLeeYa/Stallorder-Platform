import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveFlags: vi.fn(),
  documentFindFirst: vi.fn(),
  documentUpdateMany: vi.fn(),
  operationFindUnique: vi.fn(),
  operationCreate: vi.fn(),
  operationUpdate: vi.fn(),
  connectionUpdate: vi.fn(),
  transaction: vi.fn(),
  getAdapter: vi.fn(),
  createAllowance: vi.fn(),
  voidInvoice: vi.fn(),
}));

const transactionClient = {
  invoiceDocument: { updateMany: mocks.documentUpdateMany },
  invoiceProviderOperation: {
    findUnique: mocks.operationFindUnique,
    create: mocks.operationCreate,
    update: mocks.operationUpdate,
  },
  invoiceProviderConnection: { update: mocks.connectionUpdate },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoiceDocument: {
      findFirst: mocks.documentFindFirst,
      updateMany: mocks.documentUpdateMany,
    },
    invoiceProviderOperation: {
      findUnique: mocks.operationFindUnique,
      update: mocks.operationUpdate,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("./e-invoice-feature-flags", () => ({ resolveEInvoiceFeatureFlags: mocks.resolveFlags }));
vi.mock("./provider-registry", () => ({ getInvoiceProviderAdapter: mocks.getAdapter }));
vi.mock("./runtime-policy", () => ({ assertInvoiceMockEnvironment: vi.fn() }));

import { InvoiceOrchestrator } from "./invoice-orchestrator";
import { hashInvoiceRequest } from "./security";

const organizationId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";

function invoiceDocument(status = "ISSUED") {
  return {
    id: documentId,
    organizationId,
    providerConnectionId: "33333333-3333-4333-8333-333333333333",
    status,
    providerConnection: { provider: "ECPAY", environment: "MOCK" },
    externalInvoiceNumber: "TEST-INV-001",
    externalRandomCode: "1234",
    externalAllowanceReference: "TEST-ALLOWANCE-001",
    totalAmount: 500,
    taxAmount: 0,
    allowedAmount: status === "PARTIALLY_ALLOWED" ? 100 : 0,
  };
}

describe("InvoiceOrchestrator operation safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveFlags.mockResolvedValue({ EINVOICE_MERCHANT_SETUP_ENABLED: true });
    mocks.getAdapter.mockReturnValue({
      createAllowance: mocks.createAllowance,
      voidInvoice: mocks.voidInvoice,
    });
    mocks.transaction.mockImplementation(async (operation: unknown) => {
      if (typeof operation === "function") {
        return (operation as (client: typeof transactionClient) => Promise<unknown>)(transactionClient);
      }
      return Promise.all(operation as Promise<unknown>[]);
    });
    mocks.operationCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "44444444-4444-4444-8444-444444444444",
      ...data,
    }));
    mocks.operationUpdate.mockResolvedValue({});
    mocks.documentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.createAllowance.mockResolvedValue({
      providerRequestId: "provider-request-1",
      externalInvoiceNumber: "TEST-INV-001",
      externalRandomCode: "1234",
      externalAllowanceReference: "TEST-ALLOWANCE-002",
      status: "PARTIALLY_ALLOWED",
      responseCode: "MOCK_OK",
      occurredAt: new Date("2026-08-30T00:00:00.000Z"),
    });
    mocks.voidInvoice.mockResolvedValue({
      providerRequestId: "provider-request-2",
      externalInvoiceNumber: "TEST-INV-001",
      externalRandomCode: "1234",
      externalAllowanceReference: null,
      status: "VOIDED",
      responseCode: "MOCK_OK",
      occurredAt: new Date("2026-08-30T00:00:00.000Z"),
    });
  });

  it("stops existing-document operations when merchant e-invoice setup is disabled", async () => {
    mocks.resolveFlags.mockResolvedValue({ EINVOICE_MERCHANT_SETUP_ENABLED: false });

    await expect(new InvoiceOrchestrator().query({
      organizationId,
      invoiceDocumentId: documentId,
      idempotencyKey: "query-disabled",
      correlationId: "request-disabled",
    })).rejects.toMatchObject({ code: "EINVOICE_MERCHANT_SETUP_DISABLED", status: 403 });

    expect(mocks.documentFindFirst).not.toHaveBeenCalled();
    expect(mocks.getAdapter).not.toHaveBeenCalled();
  });

  it("binds allowance reason to a stable idempotency fingerprint", async () => {
    const document = invoiceDocument("PARTIALLY_ALLOWED");
    const requestHash = hashInvoiceRequest({
      amount: 100,
      reason: "顧客退貨",
      operationType: "ALLOWANCE",
      documentId,
    });
    mocks.documentFindFirst.mockResolvedValue(document);
    mocks.operationFindUnique.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      organizationId,
      invoiceDocumentId: documentId,
      operationType: "ALLOWANCE",
      idempotencyKey: "allowance:same-key",
      requestHash,
      status: "SUCCEEDED",
    });

    const orchestrator = new InvoiceOrchestrator();
    await expect(orchestrator.allowance({
      organizationId,
      invoiceDocumentId: documentId,
      idempotencyKey: "same-key",
      correlationId: "retry-1",
      amount: 100,
      reason: "顧客退貨",
    })).resolves.toMatchObject({ id: documentId, status: "PARTIALLY_ALLOWED" });

    await expect(orchestrator.allowance({
      organizationId,
      invoiceDocumentId: documentId,
      idempotencyKey: "same-key",
      correlationId: "retry-2",
      amount: 100,
      reason: "不同原因",
    })).rejects.toMatchObject({ code: "INVOICE_IDEMPOTENCY_CONFLICT", status: 409 });

    expect(mocks.createAllowance).not.toHaveBeenCalled();
  });

  it("atomically rejects a stale lifecycle claim before calling the provider", async () => {
    mocks.documentFindFirst.mockResolvedValue(invoiceDocument("ISSUED"));
    mocks.operationFindUnique.mockResolvedValue(null);
    mocks.documentUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(new InvoiceOrchestrator().void({
      organizationId,
      invoiceDocumentId: documentId,
      idempotencyKey: "void-race",
      correlationId: "race-request",
      reason: "測試併發",
    })).rejects.toMatchObject({ code: "INVOICE_OPERATION_CONCURRENT_MODIFICATION", status: 409 });

    expect(mocks.documentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: documentId, organizationId, status: "ISSUED" }),
      data: { status: "VOID_PENDING" },
    }));
    expect(mocks.voidInvoice).not.toHaveBeenCalled();
  });
});
