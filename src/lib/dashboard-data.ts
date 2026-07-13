import "server-only";

import { aggregateDailyMetrics } from "@/lib/dashboard-metrics";
import { prisma } from "@/lib/prisma";
import type { WorkspaceStall } from "@/lib/workspace";

export async function getDashboardOverview({
  organizationId,
  stalls,
  dateFrom,
  dateTo,
}: {
  organizationId: string;
  stalls: WorkspaceStall[];
  dateFrom: string;
  dateTo: string;
}) {
  const stallIds = stalls.map((stall) => stall.id);
  const rows = stallIds.length === 0 ? [] : await prisma.dailyStallSummary.findMany({
    where: {
      organizationId,
      stallId: { in: stallIds },
      businessDate: {
        gte: new Date(`${dateFrom}T00:00:00.000Z`),
        lte: new Date(`${dateTo}T00:00:00.000Z`),
      },
    },
    orderBy: [{ businessDate: "asc" }, { stallId: "asc" }],
  });

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
    trends: [...trendRows.entries()].map(([businessDate, dayRows]) => ({
      businessDate,
      ...serializeMetrics(aggregateDailyMetrics(dayRows)),
    })),
  };
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
