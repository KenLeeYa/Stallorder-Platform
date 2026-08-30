import "server-only";

import { prisma } from "@/lib/prisma";

export const eInvoiceFeatureFlagCodes = [
  "EINVOICE_PLATFORM_ENABLED",
  "EINVOICE_MERCHANT_SETUP_ENABLED",
  "EINVOICE_CHECKOUT_UI_ENABLED",
  "EINVOICE_SANDBOX_ENABLED",
  "EINVOICE_PRODUCTION_ISSUE_ENABLED",
  "EINVOICE_ECPAY_ENABLED",
  "EINVOICE_EZPAY_ENABLED",
  "EINVOICE_TRADEVAN_ENABLED",
  "EINVOICE_AUTO_ISSUE_ENABLED",
  "EINVOICE_AUTO_VOID_ENABLED",
  "EINVOICE_AUTO_ALLOWANCE_ENABLED",
  "EINVOICE_CARRIER_ENABLED",
  "EINVOICE_DONATION_ENABLED",
] as const;

export type EInvoiceFeatureFlagCode = (typeof eInvoiceFeatureFlagCodes)[number];

export const eInvoiceFeatureFlagDefaults: Record<EInvoiceFeatureFlagCode, boolean> = {
  EINVOICE_PLATFORM_ENABLED: false,
  EINVOICE_MERCHANT_SETUP_ENABLED: false,
  EINVOICE_CHECKOUT_UI_ENABLED: false,
  EINVOICE_SANDBOX_ENABLED: false,
  EINVOICE_PRODUCTION_ISSUE_ENABLED: false,
  EINVOICE_ECPAY_ENABLED: false,
  EINVOICE_EZPAY_ENABLED: false,
  EINVOICE_TRADEVAN_ENABLED: false,
  EINVOICE_AUTO_ISSUE_ENABLED: false,
  EINVOICE_AUTO_VOID_ENABLED: false,
  EINVOICE_AUTO_ALLOWANCE_ENABLED: false,
  EINVOICE_CARRIER_ENABLED: false,
  EINVOICE_DONATION_ENABLED: false,
};

export async function resolveEInvoiceFeatureFlags() {
  const rows = await prisma.billingFeatureFlag.findMany({
    where: { code: { in: [...eInvoiceFeatureFlagCodes] } },
    select: { code: true, isEnabled: true },
  });
  const stored = new Map(rows.map((row) => [row.code, row.isEnabled]));
  return Object.fromEntries(eInvoiceFeatureFlagCodes.map((code) => [
    code,
    stored.get(code) ?? eInvoiceFeatureFlagDefaults[code],
  ])) as Record<EInvoiceFeatureFlagCode, boolean>;
}
