import "server-only";

import { prisma } from "@/lib/prisma";

export const billingFeatureFlagCodes = [
  "OPEN_BETA_FREE_ACCESS_ENABLED",
  "MERCHANT_BILLING_VISIBLE",
  "MANUAL_BILLING_ENABLED",
  "AUTOMATED_BILLING_ENABLED",
  "ECPAY_BILLING_ENABLED",
  "NEWEBPAY_BILLING_ENABLED",
  "E_INVOICE_ENABLED",
  "EMAIL_BILLING_NOTIFICATIONS_ENABLED",
  "AUTOMATIC_DUNNING_ENABLED",
  "AUTOMATIC_RENEWAL_ENABLED",
  "AUTOMATIC_OVERAGE_BILLING_ENABLED",
  "COUPONS_ENABLED",
  "PRORATION_ENABLED",
  "CUSTOMER_BILLING_PORTAL_ENABLED",
  "RESELLER_BILLING_ENABLED",
  "PARTNER_BILLING_ENABLED",
  "BILLING_ANALYTICS_ADVANCED_ENABLED",
  "PAYG_BILLING_ENABLED",
  "PAYG_NEW_MERCHANTS_ENABLED",
  "PAYG_LEGACY_MIGRATION_ENABLED",
  "PAYG_REFUND_CREDITS_ENABLED",
  "PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED",
] as const;

export type BillingFeatureFlagCode = (typeof billingFeatureFlagCodes)[number];

export const billingFeatureFlagDefaults: Record<BillingFeatureFlagCode, boolean> = {
  OPEN_BETA_FREE_ACCESS_ENABLED: true,
  MERCHANT_BILLING_VISIBLE: false,
  MANUAL_BILLING_ENABLED: true,
  AUTOMATED_BILLING_ENABLED: false,
  ECPAY_BILLING_ENABLED: false,
  NEWEBPAY_BILLING_ENABLED: false,
  E_INVOICE_ENABLED: false,
  EMAIL_BILLING_NOTIFICATIONS_ENABLED: false,
  AUTOMATIC_DUNNING_ENABLED: false,
  AUTOMATIC_RENEWAL_ENABLED: false,
  AUTOMATIC_OVERAGE_BILLING_ENABLED: false,
  COUPONS_ENABLED: false,
  PRORATION_ENABLED: false,
  CUSTOMER_BILLING_PORTAL_ENABLED: false,
  RESELLER_BILLING_ENABLED: false,
  PARTNER_BILLING_ENABLED: false,
  BILLING_ANALYTICS_ADVANCED_ENABLED: false,
  PAYG_BILLING_ENABLED: false,
  PAYG_NEW_MERCHANTS_ENABLED: false,
  PAYG_LEGACY_MIGRATION_ENABLED: false,
  PAYG_REFUND_CREDITS_ENABLED: false,
  PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED: false,
};

type BillingFeatureFlagReader = {
  billingFeatureFlag: {
    findMany(input: {
      where: { code: { in: BillingFeatureFlagCode[] } };
      select: { code: true; isEnabled: true };
    }): Promise<Array<{ code: string; isEnabled: boolean }>>;
  };
};

export async function resolveBillingFeatureFlags(
  codes: readonly BillingFeatureFlagCode[] = billingFeatureFlagCodes,
  database: BillingFeatureFlagReader = prisma,
) {
  const rows = await database.billingFeatureFlag.findMany({
    where: { code: { in: [...codes] } },
    select: { code: true, isEnabled: true },
  });
  const stored = new Map(rows.map((row) => [row.code, row.isEnabled]));
  return Object.fromEntries(codes.map((code) => [
    code,
    stored.get(code) ?? billingFeatureFlagDefaults[code],
  ])) as Record<BillingFeatureFlagCode, boolean>;
}

export async function isBillingFeatureEnabled(
  code: BillingFeatureFlagCode,
  database: BillingFeatureFlagReader = prisma,
) {
  const flags = await resolveBillingFeatureFlags([code], database);
  return flags[code];
}

export async function getBillingExperienceState(database: BillingFeatureFlagReader = prisma) {
  const flags = await resolveBillingFeatureFlags([
    "OPEN_BETA_FREE_ACCESS_ENABLED",
    "MERCHANT_BILLING_VISIBLE",
    "PAYG_BILLING_ENABLED",
    "PAYG_NEW_MERCHANTS_ENABLED",
    "PAYG_LEGACY_MIGRATION_ENABLED",
    "PAYG_REFUND_CREDITS_ENABLED",
    "PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED",
  ], database);
  return {
    openBetaFreeAccess: flags.OPEN_BETA_FREE_ACCESS_ENABLED,
    merchantBillingVisible: flags.MERCHANT_BILLING_VISIBLE,
    paygBillingEnabled: flags.PAYG_BILLING_ENABLED,
    paygNewMerchantsEnabled: flags.PAYG_NEW_MERCHANTS_ENABLED,
    paygLegacyMigrationEnabled: flags.PAYG_LEGACY_MIGRATION_ENABLED,
    paygRefundCreditsEnabled: flags.PAYG_REFUND_CREDITS_ENABLED,
    paygAutomaticInvoiceCloseEnabled: flags.PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED,
  };
}
