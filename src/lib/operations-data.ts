import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildOperationsPageMeta,
  type OperationsPageRequest,
} from "@/lib/operations-pagination";

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
  pagination,
}: {
  organizationId: string;
  alertStallIds: string[];
  auditStallIds: string[];
  canViewAudit: boolean;
  filters: OperationsFilters;
  pagination: {
    alerts: OperationsPageRequest;
    auditLogs: OperationsPageRequest;
  };
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

  const alertWhere: Prisma.OperationalAlertWhereInput | null = selectedAlertStallIds.length === 0
    ? null
    : {
      organizationId,
      stallId: { in: selectedAlertStallIds },
      status: filters.alertStatus && filters.alertStatus !== "ALL" ? filters.alertStatus : undefined,
      severity: filters.alertSeverity && filters.alertSeverity !== "ALL" ? filters.alertSeverity : undefined,
    };
  const auditWhere: Prisma.AuditLogWhereInput | null = !canViewAudit
    ? null
    : {
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
    };

  const [alertTotal, auditTotal] = await Promise.all([
    alertWhere ? prisma.operationalAlert.count({ where: alertWhere }) : Promise.resolve(0),
    auditWhere ? prisma.auditLog.count({ where: auditWhere }) : Promise.resolve(0),
  ]);
  const alertPagination = buildOperationsPageMeta(alertTotal, pagination.alerts);
  const auditPagination = buildOperationsPageMeta(auditTotal, pagination.auditLogs);

  const [alerts, auditLogs] = await Promise.all([
    alertWhere ? prisma.operationalAlert.findMany({
      where: alertWhere,
      include: { stall: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
      skip: (alertPagination.page - 1) * alertPagination.pageSize,
      take: alertPagination.pageSize,
    }) : Promise.resolve([]),
    auditWhere ? prisma.auditLog.findMany({
      where: auditWhere,
      include: {
        stall: { select: { name: true } },
        actor: { select: { displayName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (auditPagination.page - 1) * auditPagination.pageSize,
      take: auditPagination.pageSize,
    }) : Promise.resolve([]),
  ]);

  return {
    alertPagination,
    auditPagination,
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
