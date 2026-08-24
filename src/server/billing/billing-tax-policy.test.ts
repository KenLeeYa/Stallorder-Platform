import { describe, expect, it } from "vitest";
import { calculateBillingTax } from "./billing-tax-policy";

const base = {
  rateBps: 500,
  jurisdiction: "TW",
  roundingMode: "HALF_UP" as const,
  roundingScope: "INVOICE" as const,
  taxDocumentRequired: true,
};

describe("calculateBillingTax", () => {
  it("extracts inclusive tax without increasing the advertised total", () => {
    expect(calculateBillingTax({ ...base, taxableAmount: 1499, treatment: "INCLUSIVE", capTaxBasis: "TAX_INCLUSIVE_TOTAL" })).toEqual({ subtotal: 1428, taxAmount: 71, totalAmount: 1499 });
  });

  it("adds exclusive tax above a pre-tax usage amount", () => {
    expect(calculateBillingTax({ ...base, taxableAmount: 1499, treatment: "EXCLUSIVE", capTaxBasis: "PRE_TAX_USAGE" })).toEqual({ subtotal: 1499, taxAmount: 75, totalAmount: 1574 });
  });

  it("keeps exempt and out-of-scope invoices tax free", () => {
    expect(calculateBillingTax({ ...base, rateBps: null, taxableAmount: 1499, treatment: "EXEMPT", capTaxBasis: null })).toEqual({ subtotal: 1499, taxAmount: 0, totalAmount: 1499 });
  });

  it("fails closed when tax policy is unresolved", () => {
    expect(() => calculateBillingTax({ ...base, rateBps: null, jurisdiction: null, taxableAmount: 1, treatment: "UNCONFIGURED", capTaxBasis: null })).toThrow("PAYG_TAX_POLICY_UNCONFIGURED");
  });

  it("supports deterministic per-line rounding", () => {
    expect(calculateBillingTax({ ...base, taxableAmount: 30, lineAmounts: [10, 10, 10], treatment: "EXCLUSIVE", capTaxBasis: "PRE_TAX_USAGE", roundingScope: "STALL_LINE" })).toEqual({ subtotal: 30, taxAmount: 3, totalAmount: 33 });
  });
});
