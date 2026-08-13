import { CashShiftBoard, type CashShiftState } from "@/components/cash-shift-board";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { requirePagePermission } from "@/lib/authorization";
import { getCashShiftState } from "@/lib/cash-shifts";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getOperationsMessage } from "@/lib/messages/operations";
import { hasPermission } from "@/lib/rbac";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function CashShiftPage({ params }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = (key: Parameters<typeof getOperationsMessage>[1]) => getOperationsMessage(locale, key);
  const { stallSlug } = await params;
  const { stall, roles } = await requirePagePermission(stallSlug, "VIEW_CASH_SHIFT", `/staff/${stallSlug}/cash`);
  const cashShiftAccess = await getFeatureAccess(stall.organizationId, "CASH_SHIFT");
  if (!cashShiftAccess.allowed) {
    return <FeatureUpgradeNotice
      title={t("cash.featureUnavailable")}
      message={t("cash.featureMessage")}
      billingHref={`/merchant/subscription?organizationId=${stall.organizationId}`}
      returnHref={`/staff/${stallSlug}`}
      returnLabel={t("cash.featureBack")}
      billingLabel={t("cash.featureBilling")}
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
