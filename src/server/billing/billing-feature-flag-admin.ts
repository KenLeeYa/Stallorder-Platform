import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getBillingExperienceState,
  type BillingFeatureFlagCode,
} from "@/server/billing/billing-feature-flags";

export const adminMutableBillingFeatureFlagCodes = [
  "OPEN_BETA_FREE_ACCESS_ENABLED",
  "MERCHANT_BILLING_VISIBLE",
  "PAYG_BILLING_ENABLED",
  "PAYG_NEW_MERCHANTS_ENABLED",
  "PAYG_LEGACY_MIGRATION_ENABLED",
  "PAYG_REFUND_CREDITS_ENABLED",
  "PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED",
] as const satisfies readonly BillingFeatureFlagCode[];

export type AdminMutableBillingFeatureFlagCode =
  (typeof adminMutableBillingFeatureFlagCodes)[number];

export type BillingFeatureFlagActor = {
  profileId: string;
  requestId: string;
  ipHash: string;
};

export async function setBillingFeatureFlag(
  code: AdminMutableBillingFeatureFlagCode,
  input: { isEnabled: boolean; reason: string },
  actor: BillingFeatureFlagActor,
) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`select code from public.billing_feature_flags where code = ${code} for update`;
    const flag = await transaction.billingFeatureFlag.findUnique({ where: { code } });
    if (!flag) throw new Error("BILLING_FEATURE_FLAG_NOT_FOUND");

    const currentState = await getBillingExperienceState(transaction);
    assertBillingFeatureFlagTransition(code, input.isEnabled, currentState);

    const updated = await transaction.billingFeatureFlag.update({
      where: { code },
      data: { isEnabled: input.isEnabled },
    });
    await transaction.auditLog.create({
      data: {
        actorProfileId: actor.profileId,
        action: "BILLING_FEATURE_FLAG_CHANGED",
        entityType: "BILLING_FEATURE_FLAG",
        entityId: null,
        outcome: "SUCCESS",
        requestId: actor.requestId,
        ipHash: actor.ipHash,
        metadata: JSON.stringify({ code, reason: input.reason.slice(0, 200) }),
        beforeJson: { code, isEnabled: flag.isEnabled } satisfies Prisma.InputJsonObject,
        afterJson: { code, isEnabled: updated.isEnabled } satisfies Prisma.InputJsonObject,
      },
    });
    return updated;
  });
}

export function assertBillingFeatureFlagTransition(
  code: AdminMutableBillingFeatureFlagCode,
  isEnabled: boolean,
  state: Awaited<ReturnType<typeof getBillingExperienceState>>,
) {
  if (!isEnabled) return;
  if (code === "PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED") {
    if (state.openBetaFreeAccess) throw new Error("PAYG_OPEN_BETA_STILL_ENABLED");
    if (!state.paygBillingEnabled) throw new Error("PAYG_BILLING_NOT_ENABLED");
    if (!state.paygRefundCreditsEnabled) throw new Error("PAYG_REFUND_CREDITS_NOT_ENABLED");
  }
  if (code === "PAYG_NEW_MERCHANTS_ENABLED" && !state.paygBillingEnabled) {
    throw new Error("PAYG_BILLING_NOT_ENABLED");
  }
  if (code === "PAYG_LEGACY_MIGRATION_ENABLED" && !state.paygBillingEnabled) {
    throw new Error("PAYG_BILLING_NOT_ENABLED");
  }
}
