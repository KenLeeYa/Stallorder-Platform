import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveEInvoiceFeatureFlags } from "./e-invoice-feature-flags";
import type { InvoiceProviderCode } from "./e-invoice-provider";
import { getInvoiceProviderAdapter } from "./provider-registry";
import { getInvoiceProviderDefinition, invoiceProviderDefinitions } from "./provider-definitions";
import { assertInvoiceMockEnvironment, isInvoiceDevMode } from "./runtime-policy";

export class InvoiceSetupError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code);
    this.name = "InvoiceSetupError";
  }
}

function maskIdentifier(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

export async function bootstrapLocalMockEInvoice(input: {
  organizationId: string;
  actorProfileId: string;
  provider: Exclude<InvoiceProviderCode, "CUSTOM">;
  correlationId: string;
}) {
  assertInvoiceMockEnvironment();
  const flags = await resolveEInvoiceFeatureFlags();
  if (!flags.EINVOICE_MERCHANT_SETUP_ENABLED) throw new InvoiceSetupError("EINVOICE_MERCHANT_SETUP_DISABLED", 403);
  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, businessName: true, email: true, phone: true },
  });
  if (!organization) throw new InvoiceSetupError("INVOICE_ORGANIZATION_NOT_FOUND", 404);
  const definition = getInvoiceProviderDefinition(input.provider);

  const result = await prisma.$transaction(async (transaction) => {
    let seller = await transaction.invoiceSellerProfile.findUnique({ where: { organizationId: input.organizationId } });
    if (!seller) {
      seller = await transaction.invoiceSellerProfile.create({
        data: {
          organizationId: input.organizationId,
          legalName: `${organization.businessName} / TEST SELLER`,
          taxId: "TEST-ONLY",
          registeredAddress: "TEST ONLY / NOT A LEGAL SELLER",
          contactName: "Local mock operator",
          contactEmail: organization.email,
          contactPhone: organization.phone,
          countryCode: "TW",
          currency: "TWD",
          defaultTaxType: "MOCK_NOT_TAX_DETERMINED",
          verificationStatus: "DRAFT",
        },
      });
    }

    const connection = await transaction.invoiceProviderConnection.upsert({
      where: {
        organizationId_provider_environment: {
          organizationId: input.organizationId,
          provider: input.provider,
          environment: "MOCK",
        },
      },
      create: {
        organizationId: input.organizationId,
        provider: input.provider,
        environment: "MOCK",
        status: "CONFIGURED",
        merchantAccountId: `TEST-${input.organizationId.slice(0, 8)}`,
        secretReference: "local-mock:server-only",
        configurationJson: { mode: "LOCAL_MOCK", legalInvoice: false, endpointOverrideAllowed: false },
        capabilitiesJson: { ...definition.mockCapabilities },
        createdByProfileId: input.actorProfileId,
        updatedByProfileId: input.actorProfileId,
        enabledAt: new Date(),
      },
      update: {
        status: "CONFIGURED",
        capabilitiesJson: { ...definition.mockCapabilities },
        updatedByProfileId: input.actorProfileId,
        lastErrorCode: null,
        lastErrorMessageSanitized: null,
        disabledAt: null,
      },
    });

    let policy = await transaction.invoicePolicyVersion.findFirst({
      where: { organizationId: input.organizationId },
      orderBy: { version: "desc" },
    });
    if (!policy) {
      policy = await transaction.invoicePolicyVersion.create({
        data: {
          organizationId: input.organizationId,
          version: 1,
          trigger: "MANUAL",
          defaultTaxType: "MOCK_NOT_TAX_DETERMINED",
          buyerFieldsRequired: { BUSINESS: ["buyerTaxId", "buyerName"], MOBILE_BARCODE: ["carrierValue"], DONATION: ["donationCode"] },
          autoVoidOnFullRefund: false,
          allowanceOnPartialRefund: false,
          carrierSupport: true,
          donationSupport: true,
          paperProofSupport: true,
          notificationMode: "NONE",
          effectiveFrom: new Date(),
          createdByProfileId: input.actorProfileId,
        },
      });
    }
    return { seller, connection, policy };
  });

  const adapter = getInvoiceProviderAdapter({ provider: input.provider, environment: "MOCK" });
  const health = await adapter.validateConnection({
    organizationId: input.organizationId,
    connectionId: result.connection.id,
    environment: "MOCK",
    correlationId: input.correlationId,
  });
  await prisma.invoiceProviderConnection.update({
    where: { id: result.connection.id },
    data: { lastValidatedAt: health.checkedAt, status: health.status === "HEALTHY" ? "CONFIGURED" : "ERROR", lastErrorCode: health.status === "HEALTHY" ? null : health.responseCode },
  });
  return { sellerProfileId: result.seller.id, connectionId: result.connection.id, policyVersionId: result.policy.id, health };
}

export async function getMerchantEInvoiceData(organizationId: string) {
  const [flags, seller, connections, policies, orders, documents] = await Promise.all([
    resolveEInvoiceFeatureFlags(),
    prisma.invoiceSellerProfile.findUnique({ where: { organizationId } }),
    prisma.invoiceProviderConnection.findMany({
      where: { organizationId },
      orderBy: [{ environment: "asc" }, { provider: "asc" }],
    }),
    prisma.invoicePolicyVersion.findMany({ where: { organizationId }, orderBy: { version: "desc" }, take: 10 }),
    prisma.order.findMany({
      where: { organizationId, status: "COMPLETED", paymentStatus: "PAID", payment: { is: { status: "PAID" } } },
      orderBy: { completedAt: "desc" },
      take: 50,
      select: { id: true, stallId: true, orderNo: true, total: true, completedAt: true, stall: { select: { name: true } } },
    }),
    prisma.invoiceDocument.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        order: { select: { orderNo: true, paymentStatus: true } },
        payment: { select: { status: true } },
        providerConnection: { select: { provider: true, environment: true } },
        operations: { orderBy: { createdAt: "desc" }, take: 5, select: { operationType: true, status: true, attempt: true, errorCode: true, createdAt: true } },
        reconciliationCases: { where: { reviewStatus: { in: ["OPEN", "IN_REVIEW"] } }, select: { id: true, caseType: true, reviewStatus: true } },
      },
    }),
  ]);

  return {
    readiness: isInvoiceDevMode() && seller && connections.some((connection) => connection.environment === "MOCK") && policies.length
      ? "LOCAL_MOCK_READY" as const
      : "ARCHITECTURE_READY" as const,
    devMode: isInvoiceDevMode(),
    flags,
    productionIssueEnabled: false,
    seller: seller ? {
      id: seller.id,
      legalName: seller.legalName,
      maskedTaxId: maskIdentifier(seller.taxId),
      verificationStatus: seller.verificationStatus,
      defaultTaxType: seller.defaultTaxType,
      testOnly: seller.taxId === "TEST-ONLY",
    } : null,
    connections: connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      environment: connection.environment,
      status: connection.status,
      maskedMerchantAccountId: maskIdentifier(connection.merchantAccountId),
      secretReferencePresent: Boolean(connection.secretReference),
      lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
      lastSuccessfulRequestAt: connection.lastSuccessfulRequestAt?.toISOString() ?? null,
      lastErrorCode: connection.lastErrorCode,
    })),
    policies: policies.map((policy) => ({
      id: policy.id,
      version: policy.version,
      trigger: policy.trigger,
      defaultTaxType: policy.defaultTaxType,
      effectiveFrom: policy.effectiveFrom.toISOString(),
      effectiveUntil: policy.effectiveUntil?.toISOString() ?? null,
    })),
    providers: invoiceProviderDefinitions.map((definition) => ({
      provider: definition.provider,
      label: definition.label,
      contractStatus: definition.contractStatus,
      mockAvailable: definition.provider !== "CUSTOM",
      officialDocumentation: [...definition.officialDocumentation],
      liveBlocker: definition.liveBlocker,
      capabilities: { ...definition.mockCapabilities },
    })),
    eligibleOrders: orders.map((order) => ({
      id: order.id,
      stallId: order.stallId,
      stallName: order.stall.name,
      orderNo: order.orderNo,
      total: order.total,
      completedAt: order.completedAt?.toISOString() ?? null,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      orderId: document.orderId,
      orderNo: document.order.orderNo,
      provider: document.providerConnection.provider,
      environment: document.providerConnection.environment,
      documentType: document.documentType,
      status: document.status,
      buyerType: document.buyerType,
      totalAmount: document.totalAmount,
      taxAmount: document.taxAmount,
      allowedAmount: document.allowedAmount,
      currency: document.currency,
      externalInvoiceNumber: document.externalInvoiceNumber,
      hasAllowanceReference: Boolean(document.externalAllowanceReference),
      issuedAt: document.issuedAt?.toISOString() ?? null,
      paymentStatus: document.payment?.status ?? document.order.paymentStatus,
      reconciliationStatus: document.reconciliationStatus,
      testDocument: document.testDocument,
      operations: document.operations.map((operation) => ({ ...operation, createdAt: operation.createdAt.toISOString() })),
      reconciliationCases: document.reconciliationCases,
    })),
  };
}

export async function getAdminEInvoiceData() {
  const [flags, connections, documents, operations, reconciliationCases] = await Promise.all([
    resolveEInvoiceFeatureFlags(),
    prisma.invoiceProviderConnection.groupBy({ by: ["provider", "environment", "status"], _count: { _all: true } }),
    prisma.invoiceDocument.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.invoiceProviderOperation.groupBy({ by: ["operationType", "status"], _count: { _all: true } }),
    prisma.invoiceReconciliationCase.count({ where: { reviewStatus: { in: ["OPEN", "IN_REVIEW"] } } }),
  ]);
  return {
    readiness: isInvoiceDevMode() && connections.some((row) => row.environment === "MOCK" && row._count._all > 0)
      ? "LOCAL_MOCK_READY" as const
      : "ARCHITECTURE_READY" as const,
    productionIssueEnabled: false,
    flags,
    providers: invoiceProviderDefinitions.map((definition) => ({
      provider: definition.provider,
      label: definition.label,
      contractStatus: definition.contractStatus,
      liveBlocker: definition.liveBlocker,
    })),
    connections: connections.map((row) => ({ provider: row.provider, environment: row.environment, status: row.status, count: row._count._all })),
    documents: documents.map((row) => ({ status: row.status, count: row._count._all })),
    operations: operations.map((row) => ({ operationType: row.operationType, status: row.status, count: row._count._all })),
    openReconciliationCases: reconciliationCases,
  };
}
