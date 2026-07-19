import { describe, expect, it } from "vitest";
import {
  adminInvoiceLineSchema,
  billingRequestDecisionSchema,
  manualPaymentSubmissionSchema,
  parseIdempotencyKey,
  subscriptionActionSchema,
} from "./billing-validation";

describe("manualPaymentSubmissionSchema", () => {
  const base = {
    invoiceId: "11111111-1111-4111-8111-111111111111",
    amount: 699,
    receivedAt: "2026-07-19T12:00:00+08:00",
  };

  it("requires bank last five digits only for bank transfer", () => {
    expect(manualPaymentSubmissionSchema.safeParse({ ...base, paymentMethod: "BANK_TRANSFER" }).success).toBe(false);
    expect(manualPaymentSubmissionSchema.safeParse({ ...base, paymentMethod: "BANK_TRANSFER", bankLastFive: "12345" }).success).toBe(true);
    expect(manualPaymentSubmissionSchema.safeParse({ ...base, paymentMethod: "CASH", bankLastFive: "12345" }).success).toBe(false);
  });

  it("accepts Phase 1 cash and manual LINE Pay records", () => {
    expect(manualPaymentSubmissionSchema.safeParse({ ...base, paymentMethod: "CASH" }).success).toBe(true);
    expect(manualPaymentSubmissionSchema.safeParse({ ...base, paymentMethod: "LINE_PAY_MANUAL", referenceNumber: "LP-20260719" }).success).toBe(true);
  });
});

describe("billing workflow validation", () => {
  it("requires a strong idempotency-key shape", () => {
    expect(parseIdempotencyKey(new Request("https://example.test", { headers: { "x-idempotency-key": "billing-payment-123" } }))).toBe("billing-payment-123");
    expect(parseIdempotencyKey(new Request("https://example.test", { headers: { "x-idempotency-key": "short" } }))).toBeNull();
    expect(parseIdempotencyKey(new Request("https://example.test", { headers: { "x-idempotency-key": "unsafe key value" } }))).toBeNull();
  });

  it("rejects future add-ons and malformed invoice lines at the API boundary", () => {
    expect(adminInvoiceLineSchema.safeParse({ itemType: "ADD_ON", code: "CUSTOM_DOMAIN", quantity: 1, reason: "人工核准" }).success).toBe(true);
    expect(adminInvoiceLineSchema.safeParse({ itemType: "CUSTOM_SERVICE", code: "bad code", description: "顧問服務", unitPrice: 1000, quantity: 1, reason: "人工報價" }).success).toBe(false);
  });

  it("bounds trial extensions and rebuild periods", () => {
    expect(subscriptionActionSchema.safeParse({ operation: "EXTEND_TRIAL", days: 91, reason: "人工延長" }).success).toBe(false);
    expect(subscriptionActionSchema.safeParse({ operation: "REBUILD_USAGE", billingPeriod: "2026-07-01", reason: "人工對帳" }).success).toBe(true);
    expect(subscriptionActionSchema.safeParse({ operation: "REBUILD_USAGE", billingPeriod: "2026-07-19", reason: "人工對帳" }).success).toBe(false);
  });

  it("requires an explicit reason when a platform admin rejects a request", () => {
    expect(billingRequestDecisionSchema.safeParse({ operation: "REJECT", note: "資料需補充" }).success).toBe(true);
    expect(billingRequestDecisionSchema.safeParse({ operation: "REJECT", note: "" }).success).toBe(false);
  });
});
