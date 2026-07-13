import { z } from "zod";

const nonCancellationStatus = z.enum(["CONFIRMED", "PREPARING", "READY", "COMPLETED"]);

export const orderStatusUpdateSchema = z.discriminatedUnion("status", [
  z.object({ status: nonCancellationStatus }).strict(),
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
