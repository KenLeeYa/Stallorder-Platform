import { describe, expect, it } from "vitest";
import { invoiceBuyerSelectionSchema } from "@/lib/e-invoice-checkout-contract";
import { decideRefundInvoiceAction } from "./refund-decision";
import { calculateInvoiceRetry } from "./retry-policy";
import { assertInvoiceMockEnvironment, assertInvoiceProductionIssueDisabled, isInvoiceDevMode } from "./runtime-policy";
import {
  decryptInvoiceSensitiveValue,
  encryptInvoiceSensitiveValue,
  redactInvoiceSecrets,
  sanitizeInvoiceErrorMessage,
  hashInvoiceRequest,
} from "./security";
import { assertInvoiceTransition, canTransitionInvoice } from "./state-machine";

describe("e-invoice domain safeguards", () => {
  it("allows documented lifecycle transitions and rejects an impossible one", () => {
    expect(canTransitionInvoice("PENDING", "ISSUING")).toBe(true);
    expect(canTransitionInvoice("ISSUED", "ALLOWANCE_PENDING")).toBe(true);
    expect(() => assertInvoiceTransition("PENDING", "VOIDED")).toThrowError("INVOICE_STATE_TRANSITION_INVALID");
  });

  it("maps full and partial refunds only when policy and capabilities approve", () => {
    expect(decideRefundInvoiceAction({
      invoiceStatus: "ISSUED",
      invoiceTotalAmount: 500,
      alreadyAllowedAmount: 0,
      refundAmount: 500,
      providerSupportsVoid: true,
      providerSupportsAllowance: true,
      policy: { autoVoidOnFullRefund: true, allowanceOnPartialRefund: true },
    })).toEqual({ action: "VOID", reason: "FULL_REFUND_POLICY_VOID" });
    expect(decideRefundInvoiceAction({
      invoiceStatus: "ISSUED",
      invoiceTotalAmount: 500,
      alreadyAllowedAmount: 0,
      refundAmount: 100,
      providerSupportsVoid: true,
      providerSupportsAllowance: true,
      policy: { autoVoidOnFullRefund: false, allowanceOnPartialRefund: true },
    })).toEqual({ action: "ALLOWANCE", amount: 100, reason: "PARTIAL_REFUND_POLICY_ALLOWANCE" });
    expect(decideRefundInvoiceAction({
      invoiceStatus: "ISSUED",
      invoiceTotalAmount: 500,
      alreadyAllowedAmount: 0,
      refundAmount: 100,
      providerSupportsVoid: false,
      providerSupportsAllowance: false,
      policy: { autoVoidOnFullRefund: false, allowanceOnPartialRefund: false },
    })).toEqual({ action: "MANUAL_REVIEW", reason: "NO_APPROVED_AUTOMATIC_ADJUSTMENT" });
  });

  it("uses bounded exponential retry and dead-letters at the limit", () => {
    const now = new Date("2026-08-30T00:00:00.000Z");
    expect(calculateInvoiceRetry({ attempt: 0, now, jitter: 0 })).toEqual({
      status: "RETRY_SCHEDULED",
      nextAttemptAt: new Date("2026-08-30T00:00:12.000Z"),
      attempt: 1,
    });
    expect(calculateInvoiceRetry({ attempt: 4, now })).toEqual({
      status: "DEAD_LETTERED",
      nextAttemptAt: null,
      attempt: 5,
    });
  });

  it("encrypts carrier values, rejects tampering, and redacts secret-shaped fields", () => {
    const environment = { NODE_ENV: "test", APP_ENV: "test", EINVOICE_DEV_MODE: "true" } as NodeJS.ProcessEnv;
    const encrypted = encryptInvoiceSensitiveValue("/ABC1234", environment);
    expect(encrypted).not.toContain("/ABC1234");
    expect(decryptInvoiceSensitiveValue(encrypted, environment)).toBe("/ABC1234");
    expect(() => decryptInvoiceSensitiveValue(`${encrypted}tampered`, environment)).toThrowError("EINVOICE_ENCRYPTED_VALUE_INVALID");
    expect(redactInvoiceSecrets({ apiKey: "secret", nested: { carrierValue: "/ABC1234", safe: "ok" } })).toEqual({
      apiKey: "[REDACTED]",
      nested: { carrierValue: "[REDACTED]", safe: "ok" },
    });
    expect(sanitizeInvoiceErrorMessage("bad\nsecret value!")).toBe("bad_secret_value_");
    expect(hashInvoiceRequest({ carrierValue: "/ABC1234" })).not.toBe(hashInvoiceRequest({ carrierValue: "/XYZ9876" }));
  });

  it("requires a real field key outside dev mode and forbids mock in production", () => {
    const production = { NODE_ENV: "production", APP_ENV: "production", EINVOICE_DEV_MODE: "true" } as NodeJS.ProcessEnv;
    expect(isInvoiceDevMode(production)).toBe(false);
    expect(() => assertInvoiceMockEnvironment(production)).toThrowError("EINVOICE_MOCK_FORBIDDEN");
    expect(() => encryptInvoiceSensitiveValue("sensitive", production)).toThrowError("EINVOICE_FIELD_ENCRYPTION_KEY_REQUIRED");
    expect(() => assertInvoiceProductionIssueDisabled({ NODE_ENV: "test", EINVOICE_PRODUCTION_ISSUE_ENABLED: "true" } as NodeJS.ProcessEnv))
      .toThrowError("EINVOICE_PRODUCTION_REQUIRES_VERIFIED_RELEASE_GATE");
  });

  it("validates provider-neutral checkout choices without arbitrary fields", () => {
    expect(invoiceBuyerSelectionSchema.safeParse({ buyerType: "MOBILE_BARCODE", carrierValue: "/ABC1234" }).success).toBe(true);
    expect(invoiceBuyerSelectionSchema.safeParse({ buyerType: "BUSINESS", buyerTaxId: "12345678", buyerName: "測試公司" }).success).toBe(true);
    expect(invoiceBuyerSelectionSchema.safeParse({ buyerType: "DONATION", donationCode: "123" }).success).toBe(true);
    expect(invoiceBuyerSelectionSchema.safeParse({ buyerType: "CLOUD", apiBaseUrl: "https://attacker.invalid" }).success).toBe(false);
  });
});
