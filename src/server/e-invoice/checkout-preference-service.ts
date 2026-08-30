import "server-only";

import { prisma } from "@/lib/prisma";
import type { InvoiceBuyerSelection } from "./e-invoice-contract";
import { resolveEInvoiceFeatureFlags } from "./e-invoice-feature-flags";
import type { InvoiceAdapterContext, InvoiceProviderCapabilities, InvoiceProviderCode } from "./e-invoice-provider";
import { getInvoiceProviderAdapter } from "./provider-registry";
import { isInvoiceDevMode } from "./runtime-policy";
import { encryptInvoiceSensitiveValue, hashInvoiceRequest } from "./security";

export type PublicEInvoiceCheckoutConfig = {
  enabled: true;
  testOnly: boolean;
  choices: {
    cloud: boolean;
    mobileBarcode: boolean;
    memberCarrier: boolean;
    business: boolean;
    donation: boolean;
    paper: boolean;
  };
};

export class InvoiceCheckoutPreferenceError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code);
    this.name = "InvoiceCheckoutPreferenceError";
  }
}

export async function getPublicEInvoiceCheckoutConfig(stallId: string): Promise<PublicEInvoiceCheckoutConfig | null> {
  const flags = await resolveEInvoiceFeatureFlags();
  if (!flags.EINVOICE_PLATFORM_ENABLED || !flags.EINVOICE_CHECKOUT_UI_ENABLED) return null;

  const environment = isInvoiceDevMode() ? "MOCK" : "PRODUCTION";
  if (environment === "PRODUCTION" && !flags.EINVOICE_PRODUCTION_ISSUE_ENABLED) return null;
  const stall = await prisma.stall.findUnique({
    where: { id: stallId },
    select: {
      organizationId: true,
      organization: {
        select: {
          invoiceProviderConnections: {
            where: {
              environment,
              status: { in: environment === "MOCK" ? ["CONFIGURED", "SANDBOX_READY"] : ["PRODUCTION_READY"] },
            },
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { capabilitiesJson: true },
          },
          invoicePolicyVersions: {
            where: {
              effectiveFrom: { lte: new Date() },
              OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
            },
            orderBy: { version: "desc" },
            take: 1,
            select: { carrierSupport: true, donationSupport: true, paperProofSupport: true },
          },
        },
      },
    },
  });
  const connection = stall?.organization.invoiceProviderConnections[0];
  const policy = stall?.organization.invoicePolicyVersions[0];
  if (!stall || !connection || !policy) return null;
  const capabilities = asCapabilities(connection.capabilitiesJson);
  const choices = {
    cloud: capabilities.b2cIssue,
    mobileBarcode: flags.EINVOICE_CARRIER_ENABLED && policy.carrierSupport && capabilities.mobileBarcode,
    memberCarrier: flags.EINVOICE_CARRIER_ENABLED && policy.carrierSupport && capabilities.memberCarrier,
    business: capabilities.b2bIssue,
    donation: flags.EINVOICE_DONATION_ENABLED && policy.donationSupport && capabilities.donationCode,
    paper: policy.paperProofSupport && capabilities.paperProof,
  };
  return Object.values(choices).some(Boolean) ? { enabled: true, testOnly: environment === "MOCK", choices } : null;
}

export async function savePublicInvoiceCheckoutPreference(input: {
  orderId: string;
  buyer: InvoiceBuyerSelection;
  correlationId: string;
}) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, organizationId: true, stallId: true },
  });
  if (!order) throw new InvoiceCheckoutPreferenceError("INVOICE_ORDER_NOT_FOUND", 404);
  const config = await getPublicEInvoiceCheckoutConfig(order.stallId);
  if (!config || !choiceEnabled(config, input.buyer.buyerType)) {
    throw new InvoiceCheckoutPreferenceError("EINVOICE_CHECKOUT_OPTION_DISABLED", 403);
  }

  const environment = config.testOnly ? "MOCK" as const : "PRODUCTION" as const;
  const connection = await prisma.invoiceProviderConnection.findFirst({
    where: {
      organizationId: order.organizationId,
      environment,
      status: { in: environment === "MOCK" ? ["CONFIGURED", "SANDBOX_READY"] : ["PRODUCTION_READY"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) throw new InvoiceCheckoutPreferenceError("EINVOICE_CONNECTION_NOT_READY", 409);
  const provider = asProvider(connection.provider);
  const adapter = getInvoiceProviderAdapter({ provider, environment });
  const context: InvoiceAdapterContext = {
    organizationId: order.organizationId,
    connectionId: connection.id,
    environment,
    correlationId: input.correlationId,
  };
  if (input.buyer.buyerType === "MOBILE_BARCODE") {
    const result = await adapter.validateMobileBarcode(context, input.buyer.carrierValue);
    if (!result.valid) throw new InvoiceCheckoutPreferenceError("INVOICE_MOBILE_BARCODE_INVALID", 400);
  }
  if (input.buyer.buyerType === "DONATION") {
    const result = await adapter.validateDonationCode(context, input.buyer.donationCode);
    if (!result.valid) throw new InvoiceCheckoutPreferenceError("INVOICE_DONATION_CODE_INVALID", 400);
  }

  const carrierValue = input.buyer.buyerType === "MOBILE_BARCODE" || input.buyer.buyerType === "MEMBER_CARRIER"
    ? input.buyer.carrierValue
    : null;
  const carrierType = input.buyer.buyerType === "MOBILE_BARCODE"
    ? "MOBILE_BARCODE"
    : input.buyer.buyerType === "MEMBER_CARRIER" ? "MEMBER" : null;
  const buyerTaxId = input.buyer.buyerType === "BUSINESS" ? input.buyer.buyerTaxId : null;
  const buyerName = input.buyer.buyerType === "BUSINESS" ? input.buyer.buyerName : null;
  const donationCode = input.buyer.buyerType === "DONATION" ? input.buyer.donationCode : null;
  const selectionSnapshotJson = {
    buyerType: input.buyer.buyerType,
    buyerTaxId: buyerTaxId ? maskIdentifier(buyerTaxId) : null,
    buyerNamePresent: Boolean(buyerName),
    carrierType,
    carrierValueHash: carrierValue ? hashInvoiceRequest({ carrierValue }) : null,
    donationCode: donationCode ? maskIdentifier(donationCode) : null,
    testOnly: config.testOnly,
  };
  return prisma.invoiceCheckoutPreference.upsert({
    where: { orderId_organizationId: { organizationId: order.organizationId, orderId: order.id } },
    create: {
      organizationId: order.organizationId,
      stallId: order.stallId,
      orderId: order.id,
      buyerType: input.buyer.buyerType,
      buyerTaxId,
      buyerName,
      carrierType,
      carrierValueEncrypted: carrierValue ? encryptInvoiceSensitiveValue(carrierValue) : null,
      donationCode,
      selectionSnapshotJson,
    },
    update: {
      buyerType: input.buyer.buyerType,
      buyerTaxId,
      buyerName,
      carrierType,
      carrierValueEncrypted: carrierValue ? encryptInvoiceSensitiveValue(carrierValue) : null,
      donationCode,
      selectionSnapshotJson,
    },
  });
}

function asProvider(value: string): InvoiceProviderCode {
  if (value === "ECPAY" || value === "EZPAY" || value === "TRADEVAN" || value === "CUSTOM") return value;
  throw new InvoiceCheckoutPreferenceError("INVOICE_PROVIDER_INVALID", 500);
}

function asCapabilities(value: unknown): InvoiceProviderCapabilities {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const capability = (key: keyof InvoiceProviderCapabilities) => record[key] === true;
  return {
    b2cIssue: capability("b2cIssue"),
    b2bIssue: capability("b2bIssue"),
    query: capability("query"),
    void: capability("void"),
    allowance: capability("allowance"),
    allowanceVoid: capability("allowanceVoid"),
    mobileBarcode: capability("mobileBarcode"),
    citizenDigitalCertificate: capability("citizenDigitalCertificate"),
    memberCarrier: capability("memberCarrier"),
    donationCode: capability("donationCode"),
    paperProof: capability("paperProof"),
    emailNotification: capability("emailNotification"),
    smsNotification: capability("smsNotification"),
    offlineIssue: capability("offlineIssue"),
    invoiceTrackManagement: capability("invoiceTrackManagement"),
    batchIssue: capability("batchIssue"),
    webhook: capability("webhook"),
    reconciliation: capability("reconciliation"),
    sandbox: capability("sandbox"),
  };
}

function choiceEnabled(config: PublicEInvoiceCheckoutConfig, buyerType: InvoiceBuyerSelection["buyerType"]) {
  if (buyerType === "CLOUD") return config.choices.cloud;
  if (buyerType === "MOBILE_BARCODE") return config.choices.mobileBarcode;
  if (buyerType === "MEMBER_CARRIER") return config.choices.memberCarrier;
  if (buyerType === "BUSINESS") return config.choices.business;
  if (buyerType === "DONATION") return config.choices.donation;
  return config.choices.paper;
}

function maskIdentifier(value: string) {
  return value.length <= 4 ? "••••" : `${"•".repeat(value.length - 4)}${value.slice(-4)}`;
}
