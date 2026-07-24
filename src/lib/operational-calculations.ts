export function discountRequiresApproval(rateBps: number, thresholdBps: number) {
  return rateBps < thresholdBps;
}

export function calculateCashExpected(input: {
  openingAmount: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  cashRefund?: number;
  correction?: number;
}) {
  return input.openingAmount
    + input.cashSales
    + input.cashIn
    - input.cashOut
    - (input.cashRefund ?? 0)
    + (input.correction ?? 0);
}
