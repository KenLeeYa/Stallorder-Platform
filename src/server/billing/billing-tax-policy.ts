export const billingTaxTreatments = ["UNCONFIGURED", "INCLUSIVE", "EXCLUSIVE", "EXEMPT", "OUT_OF_SCOPE"] as const;
export type BillingTaxTreatment = (typeof billingTaxTreatments)[number];
export const billingTaxRoundingModes = ["HALF_UP", "HALF_EVEN", "FLOOR", "CEILING"] as const;
export type BillingTaxRoundingMode = (typeof billingTaxRoundingModes)[number];
export type BillingTaxRoundingScope = "INVOICE" | "STALL_LINE";
export type BillingCapTaxBasis = "TAX_INCLUSIVE_TOTAL" | "PRE_TAX_USAGE" | null;

export type BillingTaxPolicy = {
  treatment: BillingTaxTreatment;
  rateBps: number | null;
  jurisdiction: string | null;
  roundingMode: BillingTaxRoundingMode;
  roundingScope: BillingTaxRoundingScope;
  capTaxBasis: BillingCapTaxBasis;
  taxDocumentRequired: boolean;
};

export function calculateBillingTax(input: BillingTaxPolicy & {
  taxableAmount: number;
  lineAmounts?: readonly number[];
}) {
  assertMoney(input.taxableAmount, "taxableAmount");
  assertTaxPolicy(input);
  const amounts = input.roundingScope === "STALL_LINE"
    ? validateLineAmounts(input.lineAmounts, input.taxableAmount)
    : [input.taxableAmount];

  if (input.treatment === "UNCONFIGURED") throw new Error("PAYG_TAX_POLICY_UNCONFIGURED");
  if (input.treatment === "EXEMPT" || input.treatment === "OUT_OF_SCOPE") {
    return { subtotal: input.taxableAmount, taxAmount: 0, totalAmount: input.taxableAmount };
  }

  const rateBps = input.rateBps!;
  const taxAmount = amounts.reduce((sum, amount) => sum + (input.treatment === "INCLUSIVE"
    ? roundRatio(amount * rateBps, 10_000 + rateBps, input.roundingMode)
    : roundRatio(amount * rateBps, 10_000, input.roundingMode)), 0);
  if (input.treatment === "INCLUSIVE") {
    return {
      subtotal: input.taxableAmount - taxAmount,
      taxAmount,
      totalAmount: input.taxableAmount,
    };
  }
  return {
    subtotal: input.taxableAmount,
    taxAmount,
    totalAmount: input.taxableAmount + taxAmount,
  };
}

export function assertTaxPolicy(policy: BillingTaxPolicy) {
  if (!billingTaxTreatments.includes(policy.treatment)) throw new Error("PAYG_TAX_POLICY_MISMATCH");
  if (!billingTaxRoundingModes.includes(policy.roundingMode)) throw new Error("PAYG_TAX_POLICY_MISMATCH");
  if (!(["INVOICE", "STALL_LINE"] as const).includes(policy.roundingScope)) throw new Error("PAYG_TAX_POLICY_MISMATCH");
  if (policy.treatment === "UNCONFIGURED") {
    if (policy.rateBps !== null || policy.jurisdiction !== null || policy.capTaxBasis !== null) throw new Error("PAYG_TAX_POLICY_MISMATCH");
    return;
  }
  if (!policy.jurisdiction?.trim()) throw new Error("PAYG_TAX_POLICY_MISMATCH");
  if (policy.treatment === "INCLUSIVE" || policy.treatment === "EXCLUSIVE") {
    if (!Number.isInteger(policy.rateBps) || policy.rateBps! < 0 || policy.rateBps! > 10_000) throw new Error("PAYG_TAX_POLICY_MISMATCH");
    if (policy.capTaxBasis !== "TAX_INCLUSIVE_TOTAL" && policy.capTaxBasis !== "PRE_TAX_USAGE") throw new Error("PAYG_TAX_POLICY_MISMATCH");
    return;
  }
  if (policy.rateBps !== null && policy.rateBps !== 0) throw new Error("PAYG_TAX_POLICY_MISMATCH");
}

function validateLineAmounts(values: readonly number[] | undefined, total: number) {
  if (!values?.length) throw new Error("PAYG_TAX_POLICY_MISMATCH");
  values.forEach((value) => assertMoney(value, "lineAmount"));
  if (values.reduce((sum, value) => sum + value, 0) !== total) throw new Error("PAYG_TAX_POLICY_MISMATCH");
  return values;
}

function assertMoney(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
}

function roundRatio(numerator: number, denominator: number, mode: BillingTaxRoundingMode) {
  if (!Number.isSafeInteger(numerator) || denominator <= 0) throw new RangeError("PAYG tax amount exceeds the safe integer range");
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  if (mode === "FLOOR") return quotient;
  if (mode === "CEILING") return quotient + (remainder > 0 ? 1 : 0);
  const doubled = remainder * 2;
  if (doubled < denominator) return quotient;
  if (doubled > denominator) return quotient + 1;
  if (mode === "HALF_EVEN") return quotient % 2 === 0 ? quotient : quotient + 1;
  return quotient + 1;
}
