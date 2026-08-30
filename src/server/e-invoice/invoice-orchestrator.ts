import "server-only";

import { Prisma, type InvoiceDocument, type InvoiceProviderOperation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { InvoiceBuyerSelection } from "./e-invoice-contract";
import { resolveEInvoiceFeatureFlags } from "./e-invoice-feature-flags";
import {
  assertCapability,
  InvoiceProviderError,
  invoiceLifecycleStatuses,
  invoiceProviderCodes,
  type InvoiceAdapterContext,
  type InvoiceBuyerSnapshot,
  type InvoiceLifecycleStatus,
  type InvoiceOperationType,
  type InvoiceProviderAdapter,
  type InvoiceProviderCode,
} from "./e-invoice-provider";
import { MockInvoiceProviderAdapter } from "./mock-e-invoice-provider";
import { getInvoiceProviderAdapter } from "./provider-registry";
import { calculateInvoiceRetry } from "./retry-policy";
import { decryptInvoiceSensitiveValue, encryptInvoiceSensitiveValue, hashInvoiceRequest, sanitizeInvoiceErrorMessage } from "./security";
import { assertInvoiceTransition } from "./state-machine";
import { assertInvoiceMockEnvironment } from "./runtime-policy";

export class InvoiceOperationError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code);
    this.name = "InvoiceOperationError";
  }
}

type OperationInput = { organizationId: string; invoiceDocumentId: string; idempotencyKey: string; correlationId: string };
type DocumentOperationOptions = {
  allowanceAmount?: number;
  fingerprintPayload?: Record<string, unknown>;
};

function asProvider(value: string): InvoiceProviderCode {
  if (!invoiceProviderCodes.includes(value as InvoiceProviderCode)) throw new InvoiceOperationError("INVOICE_PROVIDER_INVALID", 500);
  return value as InvoiceProviderCode;
}

function asLifecycleStatus(value: string): InvoiceLifecycleStatus {
  if (!invoiceLifecycleStatuses.includes(value as InvoiceLifecycleStatus)) throw new InvoiceOperationError("INVOICE_STATUS_INVALID", 500);
  return value as InvoiceLifecycleStatus;
}

function adapterContext(document: InvoiceDocument & { providerConnection: { provider: string; environment: string } }, correlationId: string): InvoiceAdapterContext {
  if (!(["MOCK", "SANDBOX", "PRODUCTION"] as string[]).includes(document.providerConnection.environment)) {
    throw new InvoiceOperationError("INVOICE_ENVIRONMENT_INVALID", 500);
  }
  return {
    organizationId: document.organizationId,
    connectionId: document.providerConnectionId,
    environment: document.providerConnection.environment as InvoiceAdapterContext["environment"],
    correlationId,
  };
}

function operationFailureStatus(operationType: InvoiceOperationType): InvoiceLifecycleStatus | null {
  if (operationType === "ISSUE") return "ISSUE_FAILED";
  if (operationType === "VOID") return "VOID_FAILED";
  if (operationType === "ALLOWANCE") return "ALLOWANCE_FAILED";
  if (operationType === "ALLOWANCE_VOID") return "ALLOWANCE_VOID_FAILED";
  return null;
}

function operationPendingStatus(operationType: InvoiceOperationType): InvoiceLifecycleStatus | null {
  if (operationType === "ISSUE") return "ISSUING";
  if (operationType === "VOID") return "VOID_PENDING";
  if (operationType === "ALLOWANCE") return "ALLOWANCE_PENDING";
  if (operationType === "ALLOWANCE_VOID") return "ALLOWANCE_VOID_PENDING";
  return null;
}

export class InvoiceOrchestrator {
  async issue(input: {
    organizationId: string;
    orderId: string;
    buyer?: InvoiceBuyerSelection;
    idempotencyKey: string;
    correlationId: string;
  }) {
    assertInvoiceMockEnvironment();
    const flags = await resolveEInvoiceFeatureFlags();
    if (!flags.EINVOICE_MERCHANT_SETUP_ENABLED) throw new InvoiceOperationError("EINVOICE_MERCHANT_SETUP_DISABLED", 403);

    const [seller, connection, policy, order, checkoutPreference] = await Promise.all([
      prisma.invoiceSellerProfile.findUnique({ where: { organizationId: input.organizationId } }),
      prisma.invoiceProviderConnection.findFirst({
        where: { organizationId: input.organizationId, environment: "MOCK", status: { in: ["CONFIGURED", "SANDBOX_READY"] } },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.invoicePolicyVersion.findFirst({
        where: { organizationId: input.organizationId, effectiveFrom: { lte: new Date() }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }] },
        orderBy: { version: "desc" },
      }),
      prisma.order.findFirst({
        where: { id: input.orderId, organizationId: input.organizationId },
        include: { payment: true, stall: { select: { name: true } } },
      }),
      prisma.invoiceCheckoutPreference.findFirst({
        where: { orderId: input.orderId, organizationId: input.organizationId },
      }),
    ]);

    if (!seller || !connection || !policy) throw new InvoiceOperationError("EINVOICE_SETUP_INCOMPLETE", 409);
    if (!order) throw new InvoiceOperationError("INVOICE_ORDER_NOT_FOUND", 404);
    if (order.status !== "COMPLETED" || order.paymentStatus !== "PAID" || order.payment?.status !== "PAID") {
      throw new InvoiceOperationError("INVOICE_ORDER_NOT_PAID_AND_COMPLETED", 409);
    }
    if (order.total <= 0 || !Number.isSafeInteger(order.total)) throw new InvoiceOperationError("INVOICE_ORDER_TOTAL_INVALID", 409);

    const provider = asProvider(connection.provider);
    const adapter = getInvoiceProviderAdapter({ provider, environment: "MOCK" });
    const context: InvoiceAdapterContext = {
      organizationId: input.organizationId,
      connectionId: connection.id,
      environment: "MOCK",
      correlationId: input.correlationId,
    };
    const tax = {
      salesAmount: order.total,
      taxAmount: 0,
      totalAmount: order.total,
      taxType: "MOCK_NOT_TAX_DETERMINED",
      roundingPolicy: "TEST_ONLY_NO_TAX_CALCULATION",
      currency: "TWD" as const,
    };
    let document = await prisma.invoiceDocument.findFirst({
      where: { organizationId: input.organizationId, orderId: input.orderId, documentType: "ORIGINAL" },
      include: { providerConnection: { select: { provider: true, environment: true } } },
    });
    let buyer: InvoiceBuyerSnapshot;
    if (document) {
      buyer = this.buyerFromDocument(document);
      if (input.buyer) {
        const requestedBuyer = await this.validateBuyer(adapter, context, input.buyer);
        if (hashInvoiceRequest(requestedBuyer) !== hashInvoiceRequest(buyer)) {
          throw new InvoiceOperationError("INVOICE_BUYER_SNAPSHOT_LOCKED", 409);
        }
      }
    } else {
      const buyerSelection = input.buyer ?? this.buyerFromPreference(checkoutPreference) ?? { buyerType: "CLOUD" as const };
      buyer = await this.validateBuyer(adapter, context, buyerSelection);
    }
    if (!document) {
      const buyerSnapshot = {
        buyerType: buyer.buyerType,
        buyerTaxId: buyer.buyerTaxId ?? null,
        buyerName: buyer.buyerName ?? null,
        carrierType: buyer.carrierType ?? null,
        carrierValueHash: buyer.carrierValue ? hashInvoiceRequest({ carrierValue: buyer.carrierValue }) : null,
        donationCode: buyer.donationCode ?? null,
      };
      document = await prisma.invoiceDocument.create({
        data: {
          organizationId: input.organizationId,
          stallId: order.stallId,
          orderId: order.id,
          paymentId: order.payment.id,
          providerConnectionId: connection.id,
          sellerProfileId: seller.id,
          policyVersionId: policy.id,
          documentType: "ORIGINAL",
          status: "PENDING",
          currency: "TWD",
          salesAmount: tax.salesAmount,
          taxAmount: tax.taxAmount,
          totalAmount: tax.totalAmount,
          allowedAmount: 0,
          taxType: tax.taxType,
          roundingPolicy: tax.roundingPolicy,
          buyerType: buyer.buyerType,
          buyerTaxId: buyer.buyerTaxId,
          buyerName: buyer.buyerName,
          carrierType: buyer.carrierType,
          carrierValueEncrypted: buyer.carrierValue ? encryptInvoiceSensitiveValue(buyer.carrierValue) : null,
          donationCode: buyer.donationCode,
          policySnapshotJson: {
            version: policy.version,
            trigger: policy.trigger,
            defaultTaxType: policy.defaultTaxType,
            autoVoidOnFullRefund: policy.autoVoidOnFullRefund,
            allowanceOnPartialRefund: policy.allowanceOnPartialRefund,
          },
          sellerSnapshotJson: {
            legalName: seller.legalName,
            taxId: seller.taxId,
            registeredAddress: seller.registeredAddress,
            marker: "TEST / NOT A LEGAL INVOICE",
          },
          buyerSnapshotJson: buyerSnapshot,
          testDocument: true,
        },
        include: { providerConnection: { select: { provider: true, environment: true } } },
      });
    }
    const current = asLifecycleStatus(document.status);
    if (document.externalInvoiceNumber && ["ISSUED", "VOIDED", "PARTIALLY_ALLOWED", "FULLY_ALLOWED"].includes(current)) return document;

    const request = {
      ...context,
      invoiceDocumentId: document.id,
      orderReference: order.orderNo,
      idempotencyKey: input.idempotencyKey,
      seller: { legalName: seller.legalName, taxId: seller.taxId, registeredAddress: seller.registeredAddress },
      buyer,
      tax,
    };
    const started = await this.startOperation(document, "ISSUE", input.idempotencyKey, {
      operationType: "ISSUE",
      documentId: document.id,
      orderReference: request.orderReference,
      seller: request.seller,
      buyer: request.buyer,
      tax: request.tax,
    });
    if (started.replay) return this.requireDocument(input.organizationId, document.id);
    try {
      const result = await adapter.issueInvoice(request);
      await prisma.$transaction(async (transaction) => {
        const updated = await transaction.invoiceDocument.updateMany({
          where: { id: document.id, organizationId: input.organizationId, status: "ISSUING" },
          data: {
            status: result.status,
            externalInvoiceNumber: result.externalInvoiceNumber,
            externalRandomCode: result.externalRandomCode,
            issuedAt: result.occurredAt,
            reconciliationStatus: "MATCHED",
          },
        });
        if (updated.count !== 1) throw new InvoiceOperationError("INVOICE_OPERATION_CONCURRENT_MODIFICATION", 409);
        await transaction.invoiceProviderOperation.update({
          where: { id: started.operation.id },
          data: { status: "SUCCEEDED", attempt: 1, providerRequestId: result.providerRequestId, externalReference: result.externalInvoiceNumber, responseCode: result.responseCode, completedAt: result.occurredAt },
        });
        await transaction.invoiceProviderConnection.update({
          where: { id: connection.id },
          data: { lastSuccessfulRequestAt: result.occurredAt, lastErrorCode: null, lastErrorMessageSanitized: null },
        });
      });
      return this.requireDocument(input.organizationId, document.id);
    } catch (error) {
      await this.failOperation(document.id, input.organizationId, started.operation.id, "ISSUE", error);
      throw this.toOperationError(error);
    }
  }

  async query(input: OperationInput) {
    return this.runDocumentOperation(input, "QUERY", async (adapter, document, context) => {
      const result = await adapter.queryInvoice({
        ...context,
        invoiceDocumentId: document.id,
        externalInvoiceNumber: this.requireExternalInvoiceNumber(document),
        idempotencyKey: input.idempotencyKey,
      });
      const localStatus = asLifecycleStatus(document.status);
      if (result.status !== localStatus) {
        await this.openReconciliationCase(document, "STATUS_MISMATCH", result.status);
      } else {
        await prisma.invoiceDocument.updateMany({ where: { id: document.id, organizationId: input.organizationId }, data: { reconciliationStatus: "MATCHED" } });
      }
      return result;
    });
  }

  async void(input: OperationInput & { reason: string }) {
    return this.runDocumentOperation(input, "VOID", async (adapter, document, context) => adapter.voidInvoice({
      ...context,
      invoiceDocumentId: document.id,
      externalInvoiceNumber: this.requireExternalInvoiceNumber(document),
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    }), { fingerprintPayload: { reason: input.reason } });
  }

  async allowance(input: OperationInput & { amount: number; reason: string }) {
    return this.runDocumentOperation(input, "ALLOWANCE", async (adapter, document, context) => adapter.createAllowance({
      ...context,
      invoiceDocumentId: document.id,
      externalInvoiceNumber: this.requireExternalInvoiceNumber(document),
      idempotencyKey: input.idempotencyKey,
      amount: input.amount,
      reason: input.reason,
    }), { allowanceAmount: input.amount, fingerprintPayload: { amount: input.amount, reason: input.reason } });
  }

  async voidAllowance(input: OperationInput) {
    return this.runDocumentOperation(input, "ALLOWANCE_VOID", async (adapter, document, context) => adapter.voidAllowance({
      ...context,
      invoiceDocumentId: document.id,
      externalInvoiceNumber: this.requireExternalInvoiceNumber(document),
      externalAllowanceReference: document.externalAllowanceReference ?? "",
      idempotencyKey: input.idempotencyKey,
    }));
  }

  async reconcile(input: OperationInput) {
    return this.runDocumentOperation(input, "RECONCILE", async (adapter, document, context) => {
      const result = await adapter.reconcileInvoice({
        ...context,
        invoiceDocumentId: document.id,
        externalInvoiceNumber: this.requireExternalInvoiceNumber(document),
        idempotencyKey: input.idempotencyKey,
        expectedStatus: asLifecycleStatus(document.status),
        expectedTotalAmount: document.totalAmount,
        expectedTaxAmount: document.taxAmount,
      });
      if (result.outcome === "MISMATCH") {
        for (const mismatchCode of result.mismatchCodes) await this.openReconciliationCase(document, mismatchCode, result.providerStatus, result.providerTotalAmount, result.providerTaxAmount);
      } else {
        await prisma.invoiceDocument.updateMany({ where: { id: document.id, organizationId: input.organizationId }, data: { reconciliationStatus: "MATCHED" } });
      }
      return {
        provider: asProvider(document.providerConnection.provider),
        providerRequestId: `reconcile:${input.correlationId}`,
        externalInvoiceNumber: this.requireExternalInvoiceNumber(document),
        externalRandomCode: document.externalRandomCode,
        externalAllowanceReference: document.externalAllowanceReference,
        status: result.outcome === "MISMATCH" ? "RECONCILIATION_REQUIRED" as const : asLifecycleStatus(document.status),
        responseCode: result.outcome,
        idempotentReplay: false,
        occurredAt: new Date(),
      };
    });
  }

  private async runDocumentOperation(
    input: OperationInput,
    operationType: Exclude<InvoiceOperationType, "ISSUE" | "CARRIER_VALIDATE" | "DONATION_VALIDATE">,
    invoke: (adapter: InvoiceProviderAdapter, document: Awaited<ReturnType<InvoiceOrchestrator["requireDocument"]>>, context: InvoiceAdapterContext) => Promise<{
      providerRequestId: string;
      externalInvoiceNumber: string;
      externalRandomCode: string | null;
      externalAllowanceReference: string | null;
      status: InvoiceLifecycleStatus;
      responseCode: string;
      occurredAt: Date;
    }>,
    options: DocumentOperationOptions = {},
  ) {
    assertInvoiceMockEnvironment();
    const flags = await resolveEInvoiceFeatureFlags();
    if (!flags.EINVOICE_MERCHANT_SETUP_ENABLED) throw new InvoiceOperationError("EINVOICE_MERCHANT_SETUP_DISABLED", 403);
    const document = await this.requireDocument(input.organizationId, input.invoiceDocumentId);
    if (document.providerConnection.environment !== "MOCK") throw new InvoiceOperationError("EINVOICE_EXTERNAL_PROVIDER_DISABLED", 503);
    const adapter = getInvoiceProviderAdapter({ provider: asProvider(document.providerConnection.provider), environment: "MOCK" });
    const context = adapterContext(document, input.correlationId);
    this.restoreMockAdapter(adapter, document, context);
    const allowanceAmount = options.allowanceAmount ?? 0;
    const request = { ...options.fingerprintPayload, operationType, documentId: document.id };
    const started = await this.startOperation(document, operationType, input.idempotencyKey, request);
    if (started.replay) return this.requireDocument(input.organizationId, document.id);
    try {
      const result = await invoke(adapter, document, context);
      const updates: Prisma.InvoiceDocumentUpdateManyMutationInput = {
        reconciliationStatus: operationType === "RECONCILE" || operationType === "QUERY" ? undefined : "MATCHED",
      };
      if (["VOID", "ALLOWANCE", "ALLOWANCE_VOID"].includes(operationType)) updates.status = result.status;
      if (operationType === "VOID") updates.voidedAt = result.occurredAt;
      if (operationType === "ALLOWANCE") {
        updates.allowedAmount = { increment: allowanceAmount };
        updates.externalAllowanceReference = result.externalAllowanceReference;
      }
      if (operationType === "ALLOWANCE_VOID") {
        updates.allowedAmount = 0;
        updates.externalAllowanceReference = null;
      }
      const pendingStatus = operationPendingStatus(operationType);
      await prisma.$transaction(async (transaction) => {
        const updated = await transaction.invoiceDocument.updateMany({
          where: { id: document.id, organizationId: input.organizationId, ...(pendingStatus ? { status: pendingStatus } : {}) },
          data: updates,
        });
        if (updated.count !== 1) throw new InvoiceOperationError("INVOICE_OPERATION_CONCURRENT_MODIFICATION", 409);
        await transaction.invoiceProviderOperation.update({
          where: { id: started.operation.id },
          data: { status: "SUCCEEDED", attempt: 1, providerRequestId: result.providerRequestId, externalReference: result.externalAllowanceReference ?? result.externalInvoiceNumber, responseCode: result.responseCode, completedAt: result.occurredAt },
        });
      });
      return this.requireDocument(input.organizationId, document.id);
    } catch (error) {
      await this.failOperation(document.id, input.organizationId, started.operation.id, operationType, error);
      throw this.toOperationError(error);
    }
  }

  private async validateBuyer(adapter: InvoiceProviderAdapter, context: InvoiceAdapterContext, buyer: InvoiceBuyerSelection): Promise<InvoiceBuyerSnapshot> {
    const capabilities = adapter.getCapabilities();
    if (buyer.buyerType === "MOBILE_BARCODE") {
      assertCapability(capabilities, "mobileBarcode");
      const result = await adapter.validateMobileBarcode(context, buyer.carrierValue);
      if (!result.valid) throw new InvoiceOperationError("INVOICE_MOBILE_BARCODE_INVALID", 400);
      return { buyerType: buyer.buyerType, carrierType: "MOBILE_BARCODE", carrierValue: buyer.carrierValue };
    }
    if (buyer.buyerType === "MEMBER_CARRIER") {
      assertCapability(capabilities, "memberCarrier");
      return { buyerType: buyer.buyerType, carrierType: "MEMBER", carrierValue: buyer.carrierValue };
    }
    if (buyer.buyerType === "DONATION") {
      assertCapability(capabilities, "donationCode");
      const result = await adapter.validateDonationCode(context, buyer.donationCode);
      if (!result.valid) throw new InvoiceOperationError("INVOICE_DONATION_CODE_INVALID", 400);
      return buyer;
    }
    if (buyer.buyerType === "PAPER") assertCapability(capabilities, "paperProof");
    return buyer;
  }

  private buyerFromDocument(document: InvoiceDocument): InvoiceBuyerSnapshot {
    if (document.buyerType === "CLOUD" || document.buyerType === "PAPER") {
      return { buyerType: document.buyerType };
    }
    if (document.buyerType === "MOBILE_BARCODE" || document.buyerType === "MEMBER_CARRIER") {
      if (!document.carrierValueEncrypted) throw new InvoiceOperationError("INVOICE_BUYER_SNAPSHOT_INVALID", 500);
      return {
        buyerType: document.buyerType,
        carrierType: document.buyerType === "MOBILE_BARCODE" ? "MOBILE_BARCODE" : "MEMBER",
        carrierValue: decryptInvoiceSensitiveValue(document.carrierValueEncrypted),
      };
    }
    if (document.buyerType === "BUSINESS") {
      if (!document.buyerTaxId || !document.buyerName) throw new InvoiceOperationError("INVOICE_BUYER_SNAPSHOT_INVALID", 500);
      return { buyerType: "BUSINESS", buyerTaxId: document.buyerTaxId, buyerName: document.buyerName };
    }
    if (document.buyerType === "DONATION") {
      if (!document.donationCode) throw new InvoiceOperationError("INVOICE_BUYER_SNAPSHOT_INVALID", 500);
      return { buyerType: "DONATION", donationCode: document.donationCode };
    }
    throw new InvoiceOperationError("INVOICE_BUYER_SNAPSHOT_INVALID", 500);
  }

  private buyerFromPreference(preference: {
    buyerType: string;
    buyerTaxId: string | null;
    buyerName: string | null;
    carrierValueEncrypted: string | null;
    donationCode: string | null;
  } | null): InvoiceBuyerSelection | null {
    if (!preference) return null;
    if (preference.buyerType === "CLOUD" || preference.buyerType === "PAPER") {
      return { buyerType: preference.buyerType };
    }
    if (preference.buyerType === "MOBILE_BARCODE" || preference.buyerType === "MEMBER_CARRIER") {
      if (!preference.carrierValueEncrypted) throw new InvoiceOperationError("INVOICE_CHECKOUT_PREFERENCE_INVALID", 500);
      return {
        buyerType: preference.buyerType,
        carrierValue: decryptInvoiceSensitiveValue(preference.carrierValueEncrypted),
      };
    }
    if (preference.buyerType === "BUSINESS") {
      if (!preference.buyerTaxId || !preference.buyerName) throw new InvoiceOperationError("INVOICE_CHECKOUT_PREFERENCE_INVALID", 500);
      return { buyerType: "BUSINESS", buyerTaxId: preference.buyerTaxId, buyerName: preference.buyerName };
    }
    if (preference.buyerType === "DONATION") {
      if (!preference.donationCode) throw new InvoiceOperationError("INVOICE_CHECKOUT_PREFERENCE_INVALID", 500);
      return { buyerType: "DONATION", donationCode: preference.donationCode };
    }
    throw new InvoiceOperationError("INVOICE_CHECKOUT_PREFERENCE_INVALID", 500);
  }

  private async requireDocument(organizationId: string, invoiceDocumentId: string) {
    const document = await prisma.invoiceDocument.findFirst({
      where: { id: invoiceDocumentId, organizationId },
      include: { providerConnection: { select: { provider: true, environment: true } } },
    });
    if (!document) throw new InvoiceOperationError("INVOICE_DOCUMENT_NOT_FOUND", 404);
    return document;
  }

  private requireExternalInvoiceNumber(document: InvoiceDocument) {
    if (!document.externalInvoiceNumber) throw new InvoiceOperationError("INVOICE_EXTERNAL_REFERENCE_MISSING", 409);
    return document.externalInvoiceNumber;
  }

  private async startOperation(document: InvoiceDocument, operationType: InvoiceOperationType, idempotencyKey: string, request: unknown) {
    const scopedKey = `${operationType.toLowerCase()}:${idempotencyKey}`;
    const requestHash = hashInvoiceRequest(request);
    try {
      return await prisma.$transaction(async (transaction) => {
        const existing = await transaction.invoiceProviderOperation.findUnique({
          where: { organizationId_idempotencyKey: { organizationId: document.organizationId, idempotencyKey: scopedKey } },
        });
        if (existing) return this.resolveExistingOperation(existing, document, operationType, requestHash);

        this.assertOperationCanStart(document, operationType);
        const operation = await transaction.invoiceProviderOperation.create({
          data: { organizationId: document.organizationId, invoiceDocumentId: document.id, operationType, idempotencyKey: scopedKey, requestHash, status: "RUNNING", attempt: 0, maxAttempts: 5 },
        });
        const pending = operationPendingStatus(operationType);
        if (pending) {
          const claimed = await transaction.invoiceDocument.updateMany({
            where: { id: document.id, organizationId: document.organizationId, status: document.status },
            data: { status: pending },
          });
          if (claimed.count !== 1) throw new InvoiceOperationError("INVOICE_OPERATION_CONCURRENT_MODIFICATION", 409);
        }
        return { operation, replay: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.invoiceProviderOperation.findUnique({
          where: { organizationId_idempotencyKey: { organizationId: document.organizationId, idempotencyKey: scopedKey } },
        });
        if (existing) return this.resolveExistingOperation(existing, document, operationType, requestHash);
      }
      throw error;
    }
  }

  private resolveExistingOperation(existing: InvoiceProviderOperation, document: InvoiceDocument, operationType: InvoiceOperationType, requestHash: string) {
    if (existing.invoiceDocumentId !== document.id || existing.operationType !== operationType || existing.requestHash !== requestHash) {
      throw new InvoiceOperationError("INVOICE_IDEMPOTENCY_CONFLICT", 409);
    }
    if (existing.status === "SUCCEEDED") return { operation: existing, replay: true };
    throw new InvoiceOperationError("INVOICE_OPERATION_ALREADY_STARTED", 409);
  }

  private assertOperationCanStart(document: InvoiceDocument, operationType: InvoiceOperationType) {
    const pending = operationPendingStatus(operationType);
    if (!pending) return;
    const current = asLifecycleStatus(document.status);
    if (current === pending) throw new InvoiceOperationError("INVOICE_OPERATION_ALREADY_STARTED", 409);
    assertInvoiceTransition(current, pending);
  }

  private async failOperation(documentId: string, organizationId: string, operationId: string, operationType: InvoiceOperationType, error: unknown) {
    const providerError = error instanceof InvoiceProviderError
      ? error
      : error instanceof InvoiceOperationError
        ? new InvoiceProviderError(error.code, error.status, false)
        : new InvoiceProviderError("INVOICE_PROVIDER_UNEXPECTED", 500, false);
    const retry = providerError.retryable ? calculateInvoiceRetry({ attempt: 0 }) : { status: "DEAD_LETTERED" as const, nextAttemptAt: null, attempt: 1 };
    const failedStatus = operationFailureStatus(operationType);
    const pendingStatus = operationPendingStatus(operationType);
    await prisma.$transaction([
      prisma.invoiceProviderOperation.update({
        where: { id: operationId },
        data: {
          status: retry.status,
          attempt: retry.attempt,
          nextAttemptAt: retry.nextAttemptAt,
          deadLetteredAt: retry.status === "DEAD_LETTERED" ? new Date() : null,
          errorCode: providerError.code,
          errorMessageSanitized: sanitizeInvoiceErrorMessage(providerError),
          completedAt: retry.status === "DEAD_LETTERED" ? new Date() : null,
        },
      }),
      ...(failedStatus ? [prisma.invoiceDocument.updateMany({
        where: { id: documentId, organizationId, ...(pendingStatus ? { status: pendingStatus } : {}) },
        data: { status: failedStatus },
      })] : []),
    ]);
  }

  private restoreMockAdapter(adapter: InvoiceProviderAdapter, document: Awaited<ReturnType<InvoiceOrchestrator["requireDocument"]>>, context: InvoiceAdapterContext) {
    if (!(adapter instanceof MockInvoiceProviderAdapter) || !document.externalInvoiceNumber) return;
    adapter.restoreLocalState({
      ...context,
      invoiceDocumentId: document.id,
      externalInvoiceNumber: document.externalInvoiceNumber,
      externalAllowanceReference: document.externalAllowanceReference,
      status: asLifecycleStatus(document.status),
      totalAmount: document.totalAmount,
      taxAmount: document.taxAmount,
      allowedAmount: document.allowedAmount,
    });
  }

  private async openReconciliationCase(
    document: InvoiceDocument & { providerConnection: { provider: string } },
    caseType: string,
    providerStatus: InvoiceLifecycleStatus,
    actualAmount?: number,
    actualTaxAmount?: number,
  ) {
    await prisma.$transaction([
      prisma.invoiceReconciliationCase.create({
        data: {
          organizationId: document.organizationId,
          invoiceDocumentId: document.id,
          provider: document.providerConnection.provider,
          caseType,
          expectedAmount: document.totalAmount,
          actualAmount: actualAmount ?? document.totalAmount,
          expectedTaxAmount: document.taxAmount,
          actualTaxAmount: actualTaxAmount ?? document.taxAmount,
          providerReference: document.externalInvoiceNumber,
          safeNotes: `Provider status: ${providerStatus}`,
        },
      }),
      prisma.invoiceDocument.updateMany({
        where: { id: document.id, organizationId: document.organizationId },
        data: { status: "RECONCILIATION_REQUIRED", reconciliationStatus: "OPEN" },
      }),
    ]);
  }

  private toOperationError(error: unknown) {
    if (error instanceof InvoiceOperationError) return error;
    if (error instanceof InvoiceProviderError) return new InvoiceOperationError(error.code, error.status);
    return new InvoiceOperationError("INVOICE_OPERATION_FAILED", 500);
  }
}

export const invoiceOrchestrator = new InvoiceOrchestrator();
