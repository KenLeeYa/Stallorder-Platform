import { z } from "zod";

export const lineSenderPolicySchema = z.enum(["MERCHANT_OA", "PLATFORM_OA"]);
export const lineWebhookManagementSettingsSchema = z.object({
  version: z.number().int().nonnegative().default(0),
  localMock: z.boolean().default(false),
  messagingChannelId: z.string().regex(/^\d{5,30}$/),
  senderPolicy: lineSenderPolicySchema.default("MERCHANT_OA"),
  callbackUrl: z.string().max(500).optional(),
  tested: z.object({
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    actorId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    expiresAt: z.string().datetime(),
    providerRevision: z.string().min(1).max(100),
    callbackUrl: z.string().max(500),
    senderPolicy: lineSenderPolicySchema,
  }).strict().optional(),
}).strict();

const target = {
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  integrationId: z.string().uuid(),
  environment: z.literal("local"),
  channelBinding: z.string().regex(/^[0-9a-f]{64}$/),
  expectedVersion: z.number().int().nonnegative(),
};
export const lineWebhookManagementCommandSchema = z.discriminatedUnion("operation", [
  z.object({ ...target, operation: z.literal("TEST"), callbackUrl: z.string().min(1).max(500), senderPolicy: lineSenderPolicySchema }).strict(),
  z.object({ ...target, operation: z.literal("APPLY"), testedDigest: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
]);
export type LineWebhookManagementCommand = z.infer<typeof lineWebhookManagementCommandSchema>;
