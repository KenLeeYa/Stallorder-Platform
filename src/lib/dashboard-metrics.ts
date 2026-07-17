export type DailyMetric = {
  businessDate: Date;
  orderCount: number;
  completedOrderCount: number;
  cancelledOrderCount: number;
  pendingOrderCount: number;
  unpaidOrderCount: number;
  netSales: number;
  cashAmount: number;
  manualTransferAmount: number;
  otherPaymentAmount: number;
  lastOrderAt: Date | null;
};

export function aggregateDailyMetrics(rows: readonly DailyMetric[]) {
  const totals = rows.reduce((result, row) => ({
    totalSales: result.totalSales + row.netSales,
    orderCount: result.orderCount + row.orderCount,
    completedOrderCount: result.completedOrderCount + row.completedOrderCount,
    cancelledOrderCount: result.cancelledOrderCount + row.cancelledOrderCount,
    pendingOrderCount: result.pendingOrderCount + row.pendingOrderCount,
    unpaidOrderCount: result.unpaidOrderCount + row.unpaidOrderCount,
    cashAmount: result.cashAmount + row.cashAmount,
    manualTransferAmount: result.manualTransferAmount + row.manualTransferAmount,
    otherPaymentAmount: result.otherPaymentAmount + row.otherPaymentAmount,
    lastOrderAt: latestDate(result.lastOrderAt, row.lastOrderAt),
  }), {
    totalSales: 0,
    orderCount: 0,
    completedOrderCount: 0,
    cancelledOrderCount: 0,
    pendingOrderCount: 0,
    unpaidOrderCount: 0,
    cashAmount: 0,
    manualTransferAmount: 0,
    otherPaymentAmount: 0,
    lastOrderAt: null as Date | null,
  });

  return {
    ...totals,
    averageOrderValue: totals.completedOrderCount === 0
      ? 0
      : Math.round(totals.totalSales / totals.completedOrderCount),
    cancellationRate: totals.orderCount === 0
      ? 0
      : totals.cancelledOrderCount / totals.orderCount,
  };
}

function latestDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}
