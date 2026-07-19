import "server-only";

import { prisma } from "@/lib/prisma";

export const billingFeatureFlagCodes = [
  "MANUAL_BILLING_ENABLED",
  "AUTOMATED_BILLING_ENABLED",
  "ECPAY_BILLING_ENABLED",
  "NEWEBPAY_BILLING_ENABLED",
  "E_INVOICE_ENABLED",
] as const;

export type BillingFeatureFlagCode = (typeof billingFeatureFlagCodes)[number];

export async function isBillingFeatureEnabled(code: BillingFeatureFlagCode) {
  const flag = await prisma.billingFeatureFlag.findUnique({
    where: { code },
    select: { isEnabled: true },
  });
  return flag?.isEnabled === true;
}
