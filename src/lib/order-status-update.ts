import { z } from "zod";

const nonCompletionStatus = z.enum(["CONFIRMED", "PREPARING", "PACKING", "READY"]);

export const orderStatusUpdateSchema = z.discriminatedUnion("status", [
  z.object({ status: nonCompletionStatus }).strict(),
  z.object({
    status: z.literal("COMPLETED"),
    completionIntent: z.enum(["COLLECT_PAYMENT", "FINALIZE"]).optional(),
    paymentOptionId: z.string().uuid().nullable().optional(),
    discountOptionId: z.string().uuid().nullable().optional(),
    cashReceived: z.number().int().min(0).max(100_000_000).nullable().optional(),
    discountApprovalReason: z.string().trim().min(1).max(200).nullable().optional(),
    managerEmail: z.string().trim().email().max(254).nullable().optional(),
    managerPassword: z.string().min(1).max(128).nullable().optional(),
    managerAuthorizationCode: z.string().trim().regex(/^\d{6,8}$/).nullable().optional(),
  }).strict(),
  z.object({
    status: z.literal("CANCELLED"),
    confirmationOrderNo: z.string().min(1).max(32),
    cancellationReason: z.enum(["SOLD_OUT", "CUSTOMER_CANCELLED", "WAIT_TOO_LONG", "DUPLICATE_ORDER", "OTHER"]),
    cancellationDetail: z.string().trim().min(1).max(200).nullable().optional(),
    managerAuthorizationCode: z.string().trim().regex(/^\d{6,8}$/).nullable().optional(),
  }).strict(),
]).superRefine((command, context) => {
  if (command.status === "CANCELLED" && command.cancellationReason === "OTHER" && !command.cancellationDetail) {
    context.addIssue({ code: "custom", path: ["cancellationDetail"], message: "選擇其他原因時請填寫說明。" });
  }
});

export function cancellationMatchesOrder(
  confirmationOrderNo: string,
  actualOrderNo: string,
) {
  return confirmationOrderNo === actualOrderNo;
}
