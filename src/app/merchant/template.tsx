import { headers } from "next/headers";
import { MerchantWorkspaceHeader } from "@/components/merchant-workspace-header";
import { requireWorkspacePage } from "@/lib/workspace";
import { getBillingExperienceState } from "@/server/billing/billing-feature-flags";
import { getAdminModuleVisibility } from "@/server/admin/admin-module-visibility";
import {
  MERCHANT_ROUTE_ORGANIZATION_HEADER,
  MERCHANT_ROUTE_PATHNAME_HEADER,
  MERCHANT_ROUTE_STALL_HEADER,
  resolveWorkspaceRouteContext,
} from "@/lib/workspace-route-context";

export default async function MerchantTemplate({ children }: { children: React.ReactNode }) {
  const [{ principal, workspaces }, requestHeaders, billingExperience, moduleVisibility] = await Promise.all([
    requireWorkspacePage(),
    headers(),
    getBillingExperienceState(),
    getAdminModuleVisibility(),
  ]);
  const routeContext = resolveWorkspaceRouteContext(
    workspaces,
    requestHeaders.get(MERCHANT_ROUTE_PATHNAME_HEADER) ?? "/merchant",
    requestHeaders.get(MERCHANT_ROUTE_ORGANIZATION_HEADER),
    requestHeaders.get(MERCHANT_ROUTE_STALL_HEADER),
  );

  return (
    <>
      <MerchantWorkspaceHeader
        workspaces={workspaces}
        displayName={principal.user.displayName}
        routeContext={routeContext}
        showBilling={billingExperience.merchantBillingVisible}
        showPayments={moduleVisibility.payments}
      />
      {children}
    </>
  );
}
