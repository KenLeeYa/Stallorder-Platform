import { z } from "zod";

export const merchantSetupCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("COMPLETE_STEP"),
    step: z.enum([
      "MERCHANT_PROFILE",
      "STALL_PROFILE",
      "CATALOG",
      "PAYMENT_OPTIONS",
      "TEAM",
      "QR_PREVIEW",
    ]),
  }).strict(),
  z.object({ action: z.literal("CREATE_TEST_ORDER") }).strict(),
  z.object({ action: z.literal("GO_LIVE") }).strict(),
]);

export type MerchantSetupCommand = z.infer<typeof merchantSetupCommandSchema>;
