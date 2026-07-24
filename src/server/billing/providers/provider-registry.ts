import { isBillingFeatureEnabled } from "../billing-feature-flags";
import { BillingProviderError, type BillingProvider } from "./billing-provider";
import { EcpayBillingProvider } from "./ecpay-billing-provider";
import { ManualBillingProvider } from "./manual-billing-provider";
import { NewebpayBillingProvider } from "./newebpay-billing-provider";

export type BillingProviderCode = "MANUAL" | "ECPAY" | "NEWEBPAY";

export async function resolveBillingProvider(code: BillingProviderCode): Promise<BillingProvider> {
  if (code === "MANUAL") {
    if (!await isBillingFeatureEnabled("MANUAL_BILLING_ENABLED")) {
      throw new BillingProviderError("BILLING_PROVIDER_NOT_CONFIGURED");
    }
    return new ManualBillingProvider();
  }

  const flagCode = code === "ECPAY" ? "ECPAY_BILLING_ENABLED" : "NEWEBPAY_BILLING_ENABLED";
  if (!await isBillingFeatureEnabled(flagCode)) {
    throw new BillingProviderError("BILLING_PROVIDER_NOT_CONFIGURED");
  }
  return code === "ECPAY" ? new EcpayBillingProvider() : new NewebpayBillingProvider();
}
