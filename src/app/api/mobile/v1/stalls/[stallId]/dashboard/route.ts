import { NextResponse } from "next/server";
import { mobileDashboardResponseSchema } from "@stallorder/contracts/mobile/v1";
import { getMobileSessionDeviceId } from "@/lib/auth";
import { getDashboardOverview } from "@/lib/dashboard-data";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { getAvailabilityConfig } from "@/server/resilience/availability-config-service";
import { authorizeMobileStallRequest } from "@/server/mobile/authorization";
import { calendarDateInTimeZone } from "@/server/mobile/dashboard-date";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeMobileStallRequest(request, stallId, "VIEW_REPORTS");
  if (!authorization.ok) return authorization.response;

  const stallRecord = await prisma.stall.findUnique({
    where: { id: authorization.stall.id },
    select: { timezone: true },
  });
  const date = stallRecord && calendarDateInTimeZone(new Date(), stallRecord.timezone);
  if (!date) {
    return NextResponse.json(
      { code: "STALL_TIMEZONE_UNAVAILABLE", message: "目前無法確認攤位營業日期。", requestId: authorization.requestId },
      { status: 503, headers: { "cache-control": "private, no-store", "x-request-id": authorization.requestId } },
    );
  }

  const canViewCashShift = authorization.roles.some((role) => hasPermission(role, "VIEW_CASH_SHIFT"));
  const canViewPrintQueue = authorization.roles.some((role) => hasPermission(role, "MANAGE_PRINT_QUEUE"));
  const canViewKds = authorization.stall.kdsEnabled
    && authorization.roles.some((role) => hasPermission(role, "VIEW_KDS"));
  const canViewAlerts = authorization.roles.some((role) => hasPermission(role, "MANAGE_ORDERING"));

  const [overview, openCashShift, pendingPrintJobCount, pendingKdsCount, preparingKdsCount, availability] = await Promise.all([
    getDashboardOverview({
      organizationId: authorization.workspace.id,
      stalls: [authorization.stall],
      alertStallIds: canViewAlerts ? [authorization.stall.id] : [],
      dateFrom: date,
      dateTo: date,
    }),
    canViewCashShift
      ? prisma.cashShift.findFirst({
          where: { stallId: authorization.stall.id, status: "OPEN" },
          orderBy: { openedAt: "desc" },
          select: { id: true, openedAt: true },
        })
      : Promise.resolve(null),
    canViewPrintQueue
      ? prisma.printJob.count({
          where: { stallId: authorization.stall.id, status: { in: ["PENDING", "PRINTING"] } },
        })
      : Promise.resolve(null),
    canViewKds
      ? prisma.orderProductionTask.count({
          where: { stallId: authorization.stall.id, status: "PENDING" },
        })
      : Promise.resolve(null),
    canViewKds
      ? prisma.orderProductionTask.count({
          where: { stallId: authorization.stall.id, status: "PREPARING" },
        })
      : Promise.resolve(null),
    getAvailabilityConfig(authorization.requestId, { deviceId: getMobileSessionDeviceId(request) }),
  ]);

  const response = mobileDashboardResponseSchema.parse({
    version: "v1",
    generatedAt: overview.generatedAt,
    date,
    stall: {
      id: authorization.stall.id,
      name: authorization.stall.name,
      slug: authorization.stall.slug,
      defaultCurrency: authorization.workspace.defaultCurrency,
      businessStatus: authorization.stall.businessStatus,
      orderingEnabled: authorization.stall.orderingEnabled,
    },
    summary: {
      totalSales: overview.summary.totalSales,
      orderCount: overview.summary.orderCount,
      completedOrderCount: overview.summary.completedOrderCount,
      cancelledOrderCount: overview.summary.cancelledOrderCount,
      pendingOrderCount: overview.summary.pendingOrderCount,
      averageOrderValue: overview.summary.averageOrderValue,
    },
    alerts: overview.alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      message: alert.message,
      status: alert.status,
      detectedAt: alert.detectedAt,
    })),
    openCashShift: openCashShift
      ? { id: openCashShift.id, openedAt: openCashShift.openedAt.toISOString() }
      : null,
    pendingPrintJobCount,
    kdsQueue: pendingKdsCount !== null && preparingKdsCount !== null
      ? { pending: pendingKdsCount, preparing: preparingKdsCount }
      : null,
    availability: {
      mode: availability.mode,
      staffOnline: availability.staffOnline,
      updatedAt: availability.updatedAt,
    },
  });
  return NextResponse.json(response, {
    headers: { "cache-control": "private, no-store", "x-request-id": authorization.requestId },
  });
}
