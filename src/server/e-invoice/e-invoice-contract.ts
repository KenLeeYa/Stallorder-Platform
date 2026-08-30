import { z } from "zod";
import { invoiceBuyerSelectionSchema } from "@/lib/e-invoice-checkout-contract";

export { invoiceBuyerSelectionSchema } from "@/lib/e-invoice-checkout-contract";
export type { InvoiceBuyerSelection } from "@/lib/e-invoice-checkout-contract";

const safeText = (max: number) => z.string().trim().min(1).max(max);

const documentCommand = z.object({ invoiceDocumentId: z.string().uuid() });

export const eInvoiceCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("BOOTSTRAP_MOCK"),
    provider: z.enum(["ECPAY", "EZPAY", "TRADEVAN"]),
  }).strict(),
  z.object({
    operation: z.literal("ISSUE"),
    orderId: z.string().uuid(),
    buyer: invoiceBuyerSelectionSchema,
  }).strict(),
  documentCommand.extend({ operation: z.literal("QUERY") }).strict(),
  documentCommand.extend({ operation: z.literal("VOID"), reason: safeText(300) }).strict(),
  documentCommand.extend({
    operation: z.literal("ALLOWANCE"),
    amount: z.number().int().positive().max(100_000_000),
    reason: safeText(300),
  }).strict(),
  documentCommand.extend({ operation: z.literal("ALLOWANCE_VOID") }).strict(),
  documentCommand.extend({ operation: z.literal("RECONCILE") }).strict(),
]);

export type EInvoiceCommand = z.infer<typeof eInvoiceCommandSchema>;
