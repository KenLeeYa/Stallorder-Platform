export function discountRequiresApproval(rateBps: number, thresholdBps: number) {
  return rateBps < thresholdBps;
}

export function calculateCashExpected(input: {
  openingAmount: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
}) {
  return input.openingAmount + input.cashSales + input.cashIn - input.cashOut;
}
