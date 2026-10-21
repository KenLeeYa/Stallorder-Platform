import { isIP } from "node:net";
import { z } from "zod";
import { isPrivateWebhookAddress } from "./webhook-address";

export const publicApiScopeSchema = z.enum([
  "catalog:read",
  "orders:read",
  "customers:read",
  "inventory:read",
  "webhooks:write",
]);

export const outboundWebhookEventSchema = z.enum([
  "CATALOG_PUBLISHED",
  "ORDER_CREATED",
  "ORDER_CONFIRMED",
  "ORDER_COMPLETED",
  "ORDER_CANCELLED",
  "INVENTORY_LOW",
]);

const uniqueScopesSchema = z.array(publicApiScopeSchema).min(1).max(10)
  .transform((values) => [...new Set(values)]);
const uniqueEventsSchema = z.array(outboundWebhookEventSchema).min(1).max(20)
  .transform((values) => [...new Set(values)]);

export function isSafeWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
    ) return false;
    if (isIP(hostname)) return !isPrivateWebhookAddress(hostname);
    return hostname.includes(".");
  } catch {
    return false;
  }
}

const webhookUrlSchema = z.string().trim().url().max(500)
  .refine(isSafeWebhookUrl, "Webhook 必須使用可公開連線的 HTTPS 網址");

export const developerCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("CREATE_API_KEY"),
    name: z.string().trim().min(1).max(120),
    scopes: uniqueScopesSchema,
    stallIds: z.array(z.string().uuid()).max(100).default([])
      .transform((values) => [...new Set(values)]),
    expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  }).strict(),
  z.object({
    operation: z.literal("REVOKE_API_KEY"),
    clientId: z.string().uuid(),
    reason: z.string().trim().min(1).max(300),
  }).strict(),
  z.object({
    operation: z.literal("CREATE_WEBHOOK_ENDPOINT"),
    name: z.string().trim().min(1).max(120),
    url: webhookUrlSchema,
    eventTypes: uniqueEventsSchema,
  }).strict(),
  z.object({
    operation: z.literal("SET_WEBHOOK_STATUS"),
    endpointId: z.string().uuid(),
    status: z.enum(["ACTIVE", "DISABLED"]),
  }).strict(),
  z.object({
    operation: z.literal("ROTATE_WEBHOOK_SECRET"),
    endpointId: z.string().uuid(),
  }).strict(),
]);

export type DeveloperCommand = z.infer<typeof developerCommandSchema>;
