import "server-only";

import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { prisma } from "@/lib/prisma";
import type { WorkspaceStall } from "@/lib/workspace";

export async function getDashboardOverview({
  organizationId,
  stalls,
  alertStallIds,
  dateFrom,
  dateTo,
}: {
  organizationId: string;
  stalls: WorkspaceStall[];
  alertStallIds: string[];
  dateFrom: string;
  dateTo: string;
}) {
  const stallIds = stalls.map((stall) => stall.id);
  if (alertStallIds.length > 0) {
    await prisma.$queryRaw`select public.refresh_operational_alerts(${organizationId}::uuid)`;
  }
  const [rows, alerts] = await Promise.all([
    stallIds.length === 0 ? [] : prisma.dailyStallSummary.findMany({
      where: {
        organizationId,
        stallId: { in: stallIds },
        businessDate: {
          gte: new Date(`${dateFrom}T00:00:00.000Z`),
          lte: new Date(`${dateTo}T00:00:00.000Z`),
        },
      },
      orderBy: [{ businessDate: "asc" }, { stallId: "asc" }],
    }),
    alertStallIds.length === 0 ? [] : prisma.operationalAlert.findMany({
      where: {
        organizationId,
        stallId: { in: alertStallIds },
        status: { in: ["ACTIVE", "ACKNOWLEDGED"] },
      },
      orderBy: [{ severity: "desc" }, { detectedAt: "desc" }],
      take: 20,
    }),
  ]);

  const overall = aggregateDailyMetrics(rows);
  const stallMetrics = stalls.map((stall) => {
    const metric = aggregateDailyMetrics(rows.filter((row) => row.stallId === stall.id));
    return {
      stallId: stall.id,
      stallName: stall.name,
      stallSlug: stall.slug,
      stallCode: stall.code,
      businessStatus: stall.businessStatus,
      orderingEnabled: stall.orderingEnabled,
      ...serializeMetrics(metric),
    };
  });
  const best = [...stallMetrics].sort((a, b) => b.totalSales - a.totalSales || a.stallName.localeCompare(b.stallName, "zh-TW"))[0] ?? null;
  const busiest = [...stallMetrics].sort((a, b) => b.orderCount - a.orderCount || a.stallName.localeCompare(b.stallName, "zh-TW"))[0] ?? null;

  const trendRows = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.businessDate.toISOString().slice(0, 10);
    trendRows.set(key, [...(trendRows.get(key) ?? []), row]);
  }

  return {
    generatedAt: new Date().toISOString(),
    range: { dateFrom, dateTo },
    summary: {
      ...serializeMetrics(overall),
      openStallCount: stalls.filter((stall) => stall.businessStatus === "OPEN").length,
      pausedStallCount: stalls.filter((stall) => stall.businessStatus === "PAUSED").length,
      closedStallCount: stalls.filter((stall) => stall.businessStatus === "CLOSED" || stall.businessStatus === "SOLD_OUT").length,
      bestPerformingStall: best && best.totalSales > 0 ? { stallId: best.stallId, stallName: best.stallName, totalSales: best.totalSales } : null,
      busiestStall: busiest && busiest.orderCount > 0 ? { stallId: busiest.stallId, stallName: busiest.stallName, orderCount: busiest.orderCount } : null,
    },
    stalls: stallMetrics,
    alerts: [...alerts].sort((left, right) => (
      severityRank(right.severity) - severityRank(left.severity)
      || right.detectedAt.valueOf() - left.detectedAt.valueOf()
    )).map((alert) => ({
      id: alert.id,
      stallId: alert.stallId,
      stallName: stalls.find((stall) => stall.id === alert.stallId)?.name ?? "攤位",
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      status: alert.status,
      detectedAt: alert.detectedAt.toISOString(),
    })),
    trends: [...trendRows.entries()].map(([businessDate, dayRows]) => ({
      businessDate,
      ...serializeMetrics(aggregateDailyMetrics(dayRows)),
    })),
  };
}

function severityRank(severity: string) {
  if (severity === "CRITICAL") return 3;
  if (severity === "WARNING") return 2;
  return 1;
}

function serializeMetrics(metric: ReturnType<typeof aggregateDailyMetrics>) {
  return {
    totalSales: metric.totalSales,
    orderCount: metric.orderCount,
    completedOrderCount: metric.completedOrderCount,
    cancelledOrderCount: metric.cancelledOrderCount,
    averageOrderValue: metric.averageOrderValue,
    pendingOrderCount: metric.pendingOrderCount,
    unpaidOrderCount: metric.unpaidOrderCount,
    cancellationRate: metric.cancellationRate,
    cashAmount: metric.cashAmount,
    manualTransferAmount: metric.manualTransferAmount,
    otherPaymentAmount: metric.otherPaymentAmount,
    lastOrderAt: metric.lastOrderAt?.toISOString() ?? null,
  };
}
