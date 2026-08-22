export const PAYG_CURRENCY = "TWD" as const;
export const PAYG_UNIT_PRICE = 1;
export const PAYG_MONTHLY_STALL_CAP = 1_499;
export const PAYG_MINIMUM_CHARGE = 0;

export type PaygStallUsageInput = {
  stallId: string;
  stallName: string;
  grossCompletedOrders: number;
  fullRefundCredits?: number;
  unitPrice?: number;
  capAmount?: number;
  minimumCharge?: number;
};

export type PaygStallCharge = {
  stallId: string;
  stallName: string;
  grossCompletedOrders: number;
  fullRefundCredits: number;
  netBillableOrders: number;
  unitPrice: number;
  uncappedAmount: number;
  capAmount: number;
  finalCharge: number;
  capSavings: number;
  capReached: boolean;
  currency: typeof PAYG_CURRENCY;
};

export function calculatePaygStallCharge(input: PaygStallUsageInput): PaygStallCharge {
  const grossCompletedOrders = nonNegativeInteger(input.grossCompletedOrders, "grossCompletedOrders");
  const fullRefundCredits = nonNegativeInteger(input.fullRefundCredits ?? 0, "fullRefundCredits");
  const unitPrice = nonNegativeInteger(input.unitPrice ?? PAYG_UNIT_PRICE, "unitPrice");
  const capAmount = nonNegativeInteger(input.capAmount ?? PAYG_MONTHLY_STALL_CAP, "capAmount");
  const minimumCharge = nonNegativeInteger(input.minimumCharge ?? PAYG_MINIMUM_CHARGE, "minimumCharge");
  if (minimumCharge > capAmount) throw new RangeError("minimumCharge must not exceed capAmount");

  const netBillableOrders = Math.max(grossCompletedOrders - fullRefundCredits, 0);
  const uncappedAmount = safeMultiply(netBillableOrders, unitPrice);
  const finalCharge = Math.min(Math.max(uncappedAmount, minimumCharge), capAmount);

  return {
    stallId: input.stallId,
    stallName: input.stallName,
    grossCompletedOrders,
    fullRefundCredits,
    netBillableOrders,
    unitPrice,
    uncappedAmount,
    capAmount,
    finalCharge,
    capSavings: Math.max(uncappedAmount - finalCharge, 0),
    capReached: uncappedAmount >= capAmount,
    currency: PAYG_CURRENCY,
  };
}

export function calculatePaygOrganizationCharge(inputs: readonly PaygStallUsageInput[]) {
  const stallIds = new Set<string>();
  const stalls = inputs.map((input) => {
    if (stallIds.has(input.stallId)) throw new Error(`Duplicate PAYG stall: ${input.stallId}`);
    stallIds.add(input.stallId);
    return calculatePaygStallCharge(input);
  });
  const totalCharge = stalls.reduce((total, stall) => safeAdd(total, stall.finalCharge), 0);

  return {
    stalls,
    totalCharge,
    currency: PAYG_CURRENCY,
  };
}

function nonNegativeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function safeMultiply(left: number, right: number) {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new RangeError("PAYG amount exceeds the safe integer range");
  return result;
}

function safeAdd(left: number, right: number) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError("PAYG total exceeds the safe integer range");
  return result;
}
