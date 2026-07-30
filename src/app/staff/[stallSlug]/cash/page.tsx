import { CashShiftBoard, type CashShiftState } from "@/components/cash-shift-board";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { requirePagePermission } from "@/lib/authorization";
import { getCashShiftState } from "@/lib/cash-shifts";
import { hasPermission } from "@/lib/rbac";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function CashShiftPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall, roles } = await requirePagePermission(stallSlug, "VIEW_CASH_SHIFT", `/staff/${stallSlug}/cash`);
  const cashShiftAccess = await getFeatureAccess(stall.organizationId, "CASH_SHIFT");
  if (!cashShiftAccess.allowed) {
    return <FeatureUpgradeNotice
      title="現金交班目前無法使用"
      message={cashShiftAccess.message}
      billingHref={`/merchant/subscription?organizationId=${stall.organizationId}`}
      returnHref={`/staff/${stallSlug}`}
      returnLabel="返回店員畫面"
    />;
  }
  const reconciliationAccess = await getFeatureAccess(stall.organizationId, "CASH_RECONCILIATION");
  const state = await getCashShiftState(stall.id, stall.organizationId);
  return <CashShiftBoard
    stall={{
      id: stall.id,
      organizationId: stall.organizationId,
      slug: stall.slug,
      name: stall.name,
      currency: stall.currency,
    }}
    initialState={JSON.parse(JSON.stringify(state)) as CashShiftState}
    initialPermissions={{
      canManage: roles.some((role) => hasPermission(role, "MANAGE_CASH_SHIFT")),
      canReview: reconciliationAccess.allowed && roles.some((role) => hasPermission(role, "REVIEW_CASH_SHIFT")),
      reconciliationEnabled: reconciliationAccess.allowed,
    }}
  />;
}
