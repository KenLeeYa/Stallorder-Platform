import { z } from "zod";

export const lineNotificationTemplateCodes = [
  "ORDER_CONFIRMED",
  "ORDER_READY",
  "ORDER_CANCELLED",
  "FULFILLMENT_TIME_PROPOSED",
] as const;

export type LineNotificationTemplateCode = (typeof lineNotificationTemplateCodes)[number];

const optionalHttpsUrl = z.union([
  z.literal(""),
  z.string().url().max(500).refine((value) => new URL(value).protocol === "https:", "網址必須使用 HTTPS。"),
]);

export const lineIntegrationSecretsSchema = z.object({
  channelAccessToken: z.string().trim().min(16).max(4096),
  messagingChannelSecret: z.string().trim().min(16).max(256),
  loginChannelSecret: z.string().trim().min(16).max(256),
}).strict();

export const lineRecipientSecretSchema = z.object({
  providerUserId: z.string().min(1).max(100),
  trackingToken: z.string().min(40).max(200),
}).strict();

export const lineLinkEphemeralSecretSchema = z.object({
  trackingToken: z.string().min(40).max(200),
  codeVerifier: z.string().min(43).max(128),
  nonce: z.string().min(16).max(255),
  redirectUri: z.string().url().max(500),
}).strict();

export const lineIntegrationSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  officialAccountUrl: optionalHttpsUrl.default(""),
  notifyConfirmed: z.boolean().default(true),
  notifyReady: z.boolean().default(true),
  notifyCancelled: z.boolean().default(true),
}).strict();

export const lineIntegrationCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("UPSERT"),
    channelId: z.string().trim().regex(/^[0-9]{5,30}$/, "LINE Login Channel ID 格式不正確。"),
    channelAccessToken: z.string().trim().min(16).max(4096),
    messagingChannelSecret: z.string().trim().min(16).max(256),
    loginChannelSecret: z.string().trim().min(16).max(256),
    displayName: z.string().trim().min(1).max(80),
    officialAccountUrl: optionalHttpsUrl.default(""),
    notifyConfirmed: z.boolean().default(true),
    notifyReady: z.boolean().default(true),
    notifyCancelled: z.boolean().default(true),
  }).strict(),
  z.object({
    operation: z.literal("DISABLE"),
    reason: z.string().trim().min(2).max(200),
  }).strict(),
]);

const lineWebhookSourceSchema = z.object({
  type: z.enum(["user", "group", "room"]),
  userId: z.string().min(1).max(100).optional(),
}).passthrough();

export const lineWebhookEventSchema = z.object({
  type: z.string().min(1).max(60),
  timestamp: z.number().int().nonnegative(),
  webhookEventId: z.string().min(1).max(200).optional(),
  source: lineWebhookSourceSchema.optional(),
  link: z.object({
    result: z.enum(["ok", "failed"]),
    nonce: z.string().min(10).max(255),
  }).passthrough().optional(),
}).passthrough();

export const lineWebhookBodySchema = z.object({
  destination: z.string().min(1).max(100),
  events: z.array(lineWebhookEventSchema).max(100),
}).passthrough();

export const lineOauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1),
  token_type: z.string().min(1),
}).passthrough();

export const lineVerifiedIdTokenSchema = z.object({
  iss: z.literal("https://access.line.me"),
  sub: z.string().min(1).max(100),
  aud: z.string().min(1).max(100),
  exp: z.number().int().positive(),
  nonce: z.string().min(1).max(255),
}).passthrough();
