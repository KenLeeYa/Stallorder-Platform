import { createHash } from "node:crypto";
import { assertSupportedBillingCycle } from "./billing-period";
import { assertTaxPolicy, type BillingCapTaxBasis, type BillingTaxRoundingMode, type BillingTaxRoundingScope, type BillingTaxTreatment } from "./billing-tax-policy";

export type PaygContractEntitlement = {
  featureCode: string;
  isEnabled: boolean;
  limitValue: number | null;
  configurationJson: unknown;
};

export type PaygContractVersion = {
  id: string;
  planId: string;
  version: number;
  displayName: string;
  billingInterval: string;
  basePrice: number;
  annualPrice: number | null;
  currency: string;
  trialDays: number | null;
  includedStalls: number;
  maxStalls: number | null;
  additionalStallPrice: number | null;
  maxStaff: number | null;
  maxProducts: number | null;
  maxQrCodes: number | null;
  includedOrders: number | null;
  reportRetentionDays: number | null;
  overagePolicy: string;
  pricingMode: string;
  usageUnitPrice: number;
  usageMetric: string | null;
  usageScope: string | null;
  monthlyCapAmount: number | null;
  minimumCharge: number;
  billingTimezone: string;
  billingCycleAnchorDay: number;
  billingPeriodType: string;
  invoiceCloseDelayHours: number | null;
  taxTreatment: string;
  taxRateBps: number | null;
  taxJurisdiction: string | null;
  taxRoundingMode: string;
  taxRoundingScope: string;
  capTaxBasis: string | null;
  taxDocumentRequired: boolean;
  sealedAt: Date | null;
  sealedByProfileId: string | null;
  contractHash: string | null;
  entitlements: readonly PaygContractEntitlement[];
};

export function calculatePaygContractHash(version: PaygContractVersion) {
  const payload = normalizedPaygContract(version);
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function normalizedPaygContract(version: PaygContractVersion) {
  return {
    planId: version.planId,
    version: version.version,
    displayName: version.displayName,
    billingInterval: version.billingInterval,
    basePrice: version.basePrice,
    annualPrice: version.annualPrice,
    currency: version.currency,
    trialDays: version.trialDays,
    includedStalls: version.includedStalls,
    maxStalls: version.maxStalls,
    additionalStallPrice: version.additionalStallPrice,
    maxStaff: version.maxStaff,
    maxProducts: version.maxProducts,
    maxQrCodes: version.maxQrCodes,
    includedOrders: version.includedOrders,
    reportRetentionDays: version.reportRetentionDays,
    overagePolicy: version.overagePolicy,
    pricingMode: version.pricingMode,
    usageUnitPrice: version.usageUnitPrice,
    usageMetric: version.usageMetric,
    usageScope: version.usageScope,
    monthlyCapAmount: version.monthlyCapAmount,
    minimumCharge: version.minimumCharge,
    billingTimezone: version.billingTimezone,
    billingCycleAnchorDay: version.billingCycleAnchorDay,
    billingPeriodType: version.billingPeriodType,
    invoiceCloseDelayHours: version.invoiceCloseDelayHours,
    taxTreatment: version.taxTreatment,
    taxRateBps: version.taxRateBps,
    taxJurisdiction: version.taxJurisdiction,
    taxRoundingMode: version.taxRoundingMode,
    taxRoundingScope: version.taxRoundingScope,
    capTaxBasis: version.capTaxBasis,
    taxDocumentRequired: version.taxDocumentRequired,
    entitlements: [...version.entitlements]
      .sort((left, right) => left.featureCode.localeCompare(right.featureCode))
      .map((entitlement) => ({
        featureCode: entitlement.featureCode,
        isEnabled: entitlement.isEnabled,
        limitValue: entitlement.limitValue,
        configurationJson: entitlement.configurationJson,
      })),
  };
}

export function assertPaygContractIntegrity(version: PaygContractVersion) {
  if (!version.sealedAt || !version.sealedByProfileId || !version.contractHash) {
    throw new Error("PAYG_PLAN_VERSION_NOT_SEALED");
  }
  if (calculatePaygContractHash(version) !== version.contractHash) {
    throw new Error("PAYG_CONTRACT_HASH_MISMATCH");
  }
  assertSupportedBillingCycle(version);
  assertTaxPolicy({
    treatment: version.taxTreatment as BillingTaxTreatment,
    rateBps: version.taxRateBps,
    jurisdiction: version.taxJurisdiction,
    roundingMode: version.taxRoundingMode as BillingTaxRoundingMode,
    roundingScope: version.taxRoundingScope as BillingTaxRoundingScope,
    capTaxBasis: version.capTaxBasis as BillingCapTaxBasis,
    taxDocumentRequired: version.taxDocumentRequired,
  });
  if (version.taxTreatment === "UNCONFIGURED") throw new Error("PAYG_TAX_POLICY_UNCONFIGURED");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
