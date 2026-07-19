import { NextResponse } from "next/server";
import { isBillingFeatureEnabled, type BillingFeatureFlagCode } from "../billing-feature-flags";

export async function disabledWebhookResponse(featureFlag: BillingFeatureFlagCode) {
  const enabled = await isBillingFeatureEnabled(featureFlag);
  return NextResponse.json(
    { code: enabled ? "BILLING_PROVIDER_NOT_CONFIGURED" : "SERVICE_NOT_ENABLED" },
    {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
