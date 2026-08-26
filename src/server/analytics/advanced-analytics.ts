import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export type AdvancedMetricInput = {
  orderCount: number;
  completedOrderCount: number;
  cancelledOrderCount: number;
  netSales: number;
  grossSales: number;
  discountAmount: number;
};

export const advancedKpiDictionary = [
  { code: "ORDER_ENTRY_AMOUNT", label: "訂單登記額", definition: "期間內日結摘要的 net_sales 加總；不等同金流實際入帳。", source: "daily_stall_summaries.net_sales" },
  { code: "ORDER_COUNT", label: "訂單數", definition: "期間內建立的訂單總數。", source: "daily_stall_summaries.order_count" },
  { code: "AVERAGE_ORDER_VALUE", label: "平均完成訂單金額", definition: "訂單登記額 ÷ 完成訂單數；無完成訂單時為 0。", source: "daily_stall_summaries" },
  { code: "CANCELLATION_RATE", label: "取消率", definition: "取消訂單數 ÷ 訂單總數。", source: "daily_stall_summaries" },
  { code: "DISCOUNT_RATE", label: "折扣率", definition: "折扣金額 ÷ 商品原始總額。", source: "daily_stall_summaries" },
  { code: "MODULE_DATA_HEALTH", label: "模組資料健康度", definition: "顯示進階模組目前可用的資料筆數，不推算未蒐集的顧客或外部平台資料。", source: "growth, supply, event growth, developer platform" },
] as const;

export class AdvancedAnalyticsOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AdvancedAnalyticsOperationError";
  }
}

export function calculateAdvancedKpis(rows: readonly AdvancedMetricInput[]) {
  const totals = rows.reduce((result, row) => ({
    orderEntryAmount: result.orderEntryAmount + row.netSales,
    grossSales: result.grossSales + row.grossSales,
    discountAmount: result.discountAmount + row.discountAmount,
    orderCount: result.orderCount + row.orderCount,
    completedOrderCount: result.completedOrderCount + row.completedOrderCount,
    cancelledOrderCount: result.cancelledOrderCount + row.cancelledOrderCount,
  }), { orderEntryAmount: 0, grossSales: 0, discountAmount: 0, orderCount: 0, completedOrderCount: 0, cancelledOrderCount: 0 });
  return {
    orderEntryAmount: totals.orderEntryAmount,
    orderCount: totals.orderCount,
    completedOrderCount: totals.completedOrderCount,
    averageOrderValue: totals.completedOrderCount === 0 ? 0 : Math.round(totals.orderEntryAmount / totals.completedOrderCount),
    cancellationRate: totals.orderCount === 0 ? 0 : totals.cancelledOrderCount / totals.orderCount,
    discountRate: totals.grossSales === 0 ? 0 : totals.discountAmount / totals.grossSales,
  };
}

export async function getAdvancedAnalyticsDashboard(organizationId: string) {
  const flags = await resolveResilienceFeatureFlags(
    ["MODULE_ADVANCED_ANALYTICS_ENABLED"],
    { organizationId, rolloutKey: organizationId },
  );
  if (!flags.MODULE_ADVANCED_ANALYTICS_ENABLED.enabled) {
    throw new AdvancedAnalyticsOperationError("ADVANCED_ANALYTICS_MODULE_DISABLED");
  }
  const today = new Date();
  const dateTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dateFrom = new Date(dateTo);
  dateFrom.setUTCDate(dateFrom.getUTCDate() - 29);
  const [rows, moduleCounts] = await Promise.all([
    prisma.dailyStallSummary.findMany({
      where: { organizationId, businessDate: { gte: dateFrom, lte: dateTo } },
      orderBy: [{ businessDate: "asc" }, { stallId: "asc" }],
      select: { orderCount: true, completedOrderCount: true, cancelledOrderCount: true, netSales: true, grossSales: true, discountAmount: true, lastCalculatedAt: true },
    }),
    prisma.$queryRaw<Array<{
      growthCampaigns: number;
      supplyIngredients: number;
      eventCampaigns: number;
      apiClients: number;
      webhookEndpoints: number;
    }>>`
      select
        (select count(*)::integer from public.growth_coupon_campaigns where organization_id = ${organizationId}::uuid) as "growthCampaigns",
        (select count(*)::integer from public.supply_ingredients where organization_id = ${organizationId}::uuid) as "supplyIngredients",
        (select count(*)::integer from public.event_growth_campaigns where organization_id = ${organizationId}::uuid) as "eventCampaigns",
        (select count(*)::integer from public.public_api_clients where organization_id = ${organizationId}::uuid and status = 'ACTIVE') as "apiClients",
        (select count(*)::integer from public.outbound_webhook_endpoints where organization_id = ${organizationId}::uuid and status = 'ACTIVE') as "webhookEndpoints"
    `,
  ]);
  const lastCalculatedAt = rows.reduce<Date | null>((latest, row) => !latest || row.lastCalculatedAt > latest ? row.lastCalculatedAt : latest, null);
  return {
    period: { dateFrom: dateFrom.toISOString().slice(0, 10), dateTo: dateTo.toISOString().slice(0, 10), days: 30 },
    metrics: calculateAdvancedKpis(rows),
    dataFreshness: { lastCalculatedAt: lastCalculatedAt?.toISOString() ?? null, summaryRows: rows.length },
    moduleCounts: moduleCounts[0] ?? { growthCampaigns: 0, supplyIngredients: 0, eventCampaigns: 0, apiClients: 0, webhookEndpoints: 0 },
    dictionary: advancedKpiDictionary,
    limitations: [
      "金額為訂單登記額，不代表金流實際入帳或平台結算。",
      "顧客重複購買、RFM 與跨通路歸因在同意治理及來源資料未齊前不做推估。",
      "外部平台、Webhook 與活動歸因維持 fail-closed 時，健康度只顯示已驗證資料。",
    ],
  };
}
