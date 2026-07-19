import { z } from "zod";

export const additionalStallApprovalSchema = z.object({
  quantity: z.number().int().min(1).max(100),
  unitPrice: z.number().int().min(0).max(1_000_000).optional(),
  reason: z.string().trim().min(2).max(500),
  changeRequestId: z.string().uuid().optional(),
}).strict();
