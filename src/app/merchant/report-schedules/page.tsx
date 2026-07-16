import { notFound, redirect } from "next/navigation";
import { ReportScheduleManager } from "@/components/report-schedule-manager";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getReportScheduleManagementData, reportDeliveryMode } from "@/lib/report-schedule-data";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function ReportSchedulesPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_REPORT_SCHEDULES"))) notFound();
  const [schedules, organization] = await Promise.all([
    getReportScheduleManagementData(workspace.id),
    prisma.organization.findUnique({ where: { id: workspace.id }, select: { email: true } }),
  ]);

  return (
    <ReportScheduleManager
      organizationId={workspace.id}
      organizationEmail={organization?.email ?? ""}
      stalls={workspace.stalls.filter((stall) => stall.isActive).map((stall) => ({ id: stall.id, name: stall.name }))}
      initialSchedules={schedules}
      deliveryMode={reportDeliveryMode()}
    />
  );
}
