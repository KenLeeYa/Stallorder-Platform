import { z } from "zod";

const nonCompletionStatus = z.enum(["CONFIRMED", "PREPARING", "READY"]);

export const orderStatusUpdateSchema = z.discriminatedUnion("status", [
  z.object({ status: nonCompletionStatus }).strict(),
  z.object({
    status: z.literal("COMPLETED"),
    paymentOptionId: z.string().uuid().nullable().optional(),
    discountOptionId: z.string().uuid().nullable().optional(),
    cashReceived: z.number().int().min(0).max(100_000_000).nullable().optional(),
  }).strict(),
  z.object({
    status: z.literal("CANCELLED"),
    confirmationOrderNo: z.string().min(1).max(32),
  }).strict(),
]);

export function cancellationMatchesOrder(
  confirmationOrderNo: string,
  actualOrderNo: string,
) {
  return confirmationOrderNo === actualOrderNo;
}
