import { z } from "zod";

const uuid = z.string().uuid();
const reason = z.string().trim().min(2).max(500);

export const planChangeRequestSchema = z.object({
  planVersionId: uuid,
  billingInterval: z.enum(["MONTHLY", "ANNUAL"]),
  reason,
}).strict();

export const additionalStallRequestSchema = z.object({
  quantity: z.number().int().min(1).max(100),
  reason,
}).strict();

export const manualPaymentSubmissionSchema = z.object({
  invoiceId: uuid,
  paymentMethod: z.enum(["BANK_TRANSFER", "CASH", "LINE_PAY_MANUAL", "OTHER"]),
  amount: z.number().int().min(1).max(100_000_000),
  referenceNumber: z.string().trim().min(2).max(120).optional(),
  bankLastFive: z.string().regex(/^[0-9]{5}$/).optional(),
  receivedAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.paymentMethod === "BANK_TRANSFER" && !value.bankLastFive) {
    context.addIssue({ code: "custom", path: ["bankLastFive"], message: "銀行轉帳需填寫帳號末五碼。" });
  }
  if (value.paymentMethod !== "BANK_TRANSFER" && value.bankLastFive) {
    context.addIssue({ code: "custom", path: ["bankLastFive"], message: "只有銀行轉帳可填寫帳號末五碼。" });
  }
});

export const adminInvoiceCreateSchema = z.object({
  organizationId: uuid,
  planVersionId: uuid,
  billingInterval: z.enum(["MONTHLY", "ANNUAL"]),
  dueAt: z.string().datetime({ offset: true }),
  requestId: uuid.optional(),
}).strict();

export const paymentDecisionSchema = z.object({
  note: z.string().trim().min(2).max(1000),
}).strict();

const invoiceLineBase = {
  quantity: z.number().int().min(1).max(100),
  reason,
};

export const adminInvoiceLineSchema = z.discriminatedUnion("itemType", [
  z.object({
    itemType: z.literal("ADD_ON"),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    ...invoiceLineBase,
  }).strict(),
  z.object({
    itemType: z.enum(["CUSTOM_SERVICE", "CREDIT", "DISCOUNT"]),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    description: z.string().trim().min(2).max(300),
    unitPrice: z.number().int().min(0).max(100_000_000),
    ...invoiceLineBase,
  }).strict(),
]);

export const adminInvoiceActionSchema = z.object({
  operation: z.literal("VOID"),
  reason,
}).strict();

export const billingRequestDecisionSchema = z.object({
  operation: z.literal("REJECT"),
  note: reason,
}).strict();

export const billingFeatureFlagUpdateSchema = z.object({
  isEnabled: z.boolean(),
  reason,
}).strict();

export const subscriptionActionSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("SUSPEND"), reason }).strict(),
  z.object({ operation: z.literal("REACTIVATE"), reason }).strict(),
  z.object({ operation: z.literal("ACTIVATE"), reason }).strict(),
  z.object({
    operation: z.literal("EXTEND_TRIAL"),
    days: z.number().int().min(1).max(90),
    reason,
  }).strict(),
  z.object({
    operation: z.literal("ASSIGN_ORDER_PACKAGE"),
    code: z.enum([
      "ORDER_PACKAGE_LITE_100",
      "ORDER_PACKAGE_STANDARD_500",
      "ORDER_PACKAGE_PRO_1000",
    ]),
    quantity: z.number().int().min(1).max(100),
    reason,
  }).strict(),
  z.object({
    operation: z.literal("REBUILD_USAGE"),
    billingPeriod: z.string().regex(/^\d{4}-\d{2}-01$/),
    reason,
  }).strict(),
  z.object({
    operation: z.literal("MIGRATE_TO_PAYG"),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    confirmation: z.literal("MIGRATE_TO_PAYG"),
    changeRequestId: uuid.optional(),
    reason,
  }).strict(),
  z.object({
    operation: z.literal("CLOSE_PAYG_PERIOD"),
    billingPeriod: z.string().regex(/^\d{4}-\d{2}-01$/),
    reason,
  }).strict(),
]);

export function parseIdempotencyKey(request: Request) {
  const value = request.headers.get("x-idempotency-key")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,120}$/.test(value) ? value : null;
}
