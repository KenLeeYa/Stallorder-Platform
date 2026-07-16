import { notFound, redirect } from "next/navigation";
import { OperationsConsole } from "@/components/operations-console";
import { getOperationsConsoleData, type OperationsFilters } from "@/lib/operations-data";
import { authorizedStallIdsForPermission, hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]) {
  return value && allowed.includes(value as T) ? value as T : undefined;
}

export default async function OperationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const organizationId = single(params.organizationId);
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const canViewAudit = workspace.roles.some((role) => hasPermission(role, "VIEW_AUDIT_LOGS"));
  const alertStallIds = authorizedStallIdsForPermission(workspace.stalls, "MANAGE_OPERATIONAL_ALERTS");
  if (!canViewAudit && alertStallIds.length === 0) notFound();
  const requestedStallId = single(params.stallId);
  if (requestedStallId && !workspace.stalls.some((stall) => stall.id === requestedStallId)) notFound();

  const filters: OperationsFilters = {
    stallId: requestedStallId,
    alertStatus: oneOf(single(params.alertStatus), ["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "ALL"]),
    alertSeverity: oneOf(single(params.alertSeverity), ["INFO", "WARNING", "CRITICAL", "ALL"]),
    auditOutcome: oneOf(single(params.auditOutcome), ["SUCCESS", "DENIED", "FAILURE", "ALL"]),
    auditQuery: single(params.auditQuery),
    dateFrom: single(params.dateFrom),
    dateTo: single(params.dateTo),
  };
  const data = await getOperationsConsoleData({
    organizationId: workspace.id,
    alertStallIds,
    auditStallIds: canViewAudit ? workspace.stalls.map((stall) => stall.id) : [],
    canViewAudit,
    filters,
  });
  const visibleStalls = workspace.stalls.filter((stall) => canViewAudit || alertStallIds.includes(stall.id));

  return (
    <OperationsConsole
      organizationId={workspace.id}
      stalls={visibleStalls.map((stall) => ({ id: stall.id, name: stall.name }))}
      alerts={data.alerts}
      auditLogs={data.auditLogs}
      canManageAlerts={alertStallIds.length > 0}
      canViewAudit={canViewAudit}
      filters={filters}
    />
  );
}
