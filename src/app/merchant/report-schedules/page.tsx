import { notFound, redirect } from "next/navigation";
import { LazyReportScheduleManager } from "@/components/lazy-report-schedule-manager";
import { FeatureUpgradeNotice } from "@/components/feature-upgrade-notice";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { createReportScheduleTranslator } from "@/lib/messages/report-schedules";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getReportScheduleManagementData, reportDeliveryMode } from "@/lib/report-schedule-data";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string }> };

export default async function ReportSchedulesPage({ searchParams }: PageProps) {
  const { locale } = await getRequestAppLocale();
  const t = createReportScheduleTranslator(locale);
  const { organizationId, stallId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_REPORT_SCHEDULES"))) notFound();
  const returnStallId = workspace.stalls.some((stall) => stall.id === stallId) ? stallId : undefined;
  const featureAccess = await getFeatureAccess(workspace.id, "SCHEDULED_REPORTS");
  if (!featureAccess.allowed) {
    return (
      <FeatureUpgradeNotice
        title={t("schedule.featureTitle")}
        message={featureAccess.message}
        billingHref={`/merchant/subscription?organizationId=${workspace.id}`}
        returnHref={`/merchant/stalls?organizationId=${workspace.id}`}
        returnLabel={t("schedule.backToStalls")}
        returnStallId={returnStallId}
      />
    );
  }
  const [schedules, organization] = await Promise.all([
    getReportScheduleManagementData(workspace.id),
    prisma.organization.findUnique({ where: { id: workspace.id }, select: { email: true } }),
  ]);

  return (
    <LazyReportScheduleManager
      organizationId={workspace.id}
      organizationEmail={organization?.email ?? ""}
      stalls={workspace.stalls.filter((stall) => stall.isActive).map((stall) => ({ id: stall.id, name: stall.name }))}
      initialSchedules={schedules}
      deliveryMode={reportDeliveryMode()}
      returnStallId={returnStallId}
    />
  );
}
