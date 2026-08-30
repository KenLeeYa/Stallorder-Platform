import { z } from "zod";

const safeText = (max: number) => z.string().trim().min(1).max(max);

export const invoiceBuyerSelectionSchema = z.discriminatedUnion("buyerType", [
  z.object({ buyerType: z.literal("CLOUD") }).strict(),
  z.object({
    buyerType: z.literal("MOBILE_BARCODE"),
    carrierValue: z.string().trim().toUpperCase().regex(/^\/[0-9A-Z.+-]{7}$/),
  }).strict(),
  z.object({
    buyerType: z.literal("MEMBER_CARRIER"),
    carrierValue: safeText(64),
  }).strict(),
  z.object({
    buyerType: z.literal("BUSINESS"),
    buyerTaxId: z.string().trim().regex(/^\d{8}$/),
    buyerName: safeText(200),
  }).strict(),
  z.object({
    buyerType: z.literal("DONATION"),
    donationCode: z.string().trim().regex(/^\d{3,7}$/),
  }).strict(),
  z.object({ buyerType: z.literal("PAPER") }).strict(),
]);

export type InvoiceBuyerSelection = z.infer<typeof invoiceBuyerSelectionSchema>;
