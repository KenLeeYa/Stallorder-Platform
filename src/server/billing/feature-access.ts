import "server-only";

import {
  entitlementErrorFromUnknown,
  entitlementService,
} from "@/server/billing/entitlement-service";

export async function getFeatureAccess(
  organizationId: string,
  featureCode: string,
  options: { requireUsableSubscription?: boolean } = {},
) {
  try {
    if (options.requireUsableSubscription === false) {
      await entitlementService.assertFeatureIncluded(organizationId, featureCode);
    } else {
      await entitlementService.assertFeatureEnabled(organizationId, featureCode);
    }
    return { allowed: true as const };
  } catch (error) {
    const entitlementError = entitlementErrorFromUnknown(error);
    if (!entitlementError) throw error;
    return {
      allowed: false as const,
      code: entitlementError.code,
      message: entitlementError.message,
    };
  }
}
