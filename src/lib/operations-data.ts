import "server-only";

import { prisma } from "@/lib/prisma";

export type OperationsFilters = {
  stallId?: string;
  alertStatus?: "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "ALL";
  alertSeverity?: "INFO" | "WARNING" | "CRITICAL" | "ALL";
  auditOutcome?: "SUCCESS" | "DENIED" | "FAILURE" | "ALL";
  auditQuery?: string;
  dateFrom?: string;
  dateTo?: string;
};

function startOfDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

function endOfDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : undefined;
}

export async function getOperationsConsoleData({
  organizationId,
  alertStallIds,
  auditStallIds,
  canViewAudit,
  filters,
}: {
  organizationId: string;
  alertStallIds: string[];
  auditStallIds: string[];
  canViewAudit: boolean;
  filters: OperationsFilters;
}) {
  if (alertStallIds.length > 0) {
    await prisma.$queryRaw`select public.refresh_operational_alerts(${organizationId}::uuid)`;
  }
  const selectedAlertStallIds = filters.stallId && alertStallIds.includes(filters.stallId)
    ? [filters.stallId]
    : alertStallIds;
  const selectedAuditStallIds = filters.stallId && auditStallIds.includes(filters.stallId)
    ? [filters.stallId]
    : auditStallIds;
  const auditQuery = filters.auditQuery?.trim().slice(0, 80);

  const alerts = selectedAlertStallIds.length === 0 ? [] : await prisma.operationalAlert.findMany({
      where: {
        organizationId,
        stallId: { in: selectedAlertStallIds },
        status: filters.alertStatus && filters.alertStatus !== "ALL" ? filters.alertStatus : undefined,
        severity: filters.alertSeverity && filters.alertSeverity !== "ALL" ? filters.alertSeverity : undefined,
      },
      include: { stall: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
      take: 100,
    });
  const auditLogs = !canViewAudit ? [] : await prisma.auditLog.findMany({
      where: {
        organizationId,
        OR: [
          { stallId: null },
          ...(selectedAuditStallIds.length > 0 ? [{ stallId: { in: selectedAuditStallIds } }] : []),
        ],
        outcome: filters.auditOutcome && filters.auditOutcome !== "ALL" ? filters.auditOutcome : undefined,
        createdAt: { gte: startOfDate(filters.dateFrom), lte: endOfDate(filters.dateTo) },
        ...(auditQuery ? {
          AND: [{
            OR: [
              { action: { contains: auditQuery, mode: "insensitive" as const } },
              { entityType: { contains: auditQuery, mode: "insensitive" as const } },
              { requestId: { contains: auditQuery, mode: "insensitive" as const } },
            ],
          }],
        } : {}),
      },
      include: {
        stall: { select: { name: true } },
        actor: { select: { displayName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

  return {
    alerts: alerts.map((alert) => ({
      id: alert.id,
      stallId: alert.stallId,
      stallName: alert.stall.name,
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      status: alert.status,
      detectedAt: alert.detectedAt.toISOString(),
      acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    })),
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      outcome: log.outcome,
      requestId: log.requestId,
      stallName: log.stall?.name ?? "組織層級",
      actorName: log.actor?.displayName ?? "系統",
      actorEmail: log.actor?.email ?? null,
      metadata: log.metadata,
      before: log.beforeJson,
      after: log.afterJson,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}
