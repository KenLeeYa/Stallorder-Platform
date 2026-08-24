import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readBoundedText } from "../../bounded-text-reader";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import {
  createEnvironmentDeliverySecretResolver,
  type DeliverySecretResolver,
} from "../../delivery-secret-resolver";
import type { DeliveryPlatformConnectionContext } from "../../delivery-platform-types";
import { getUberEatsOAuthConfig } from "./uber-eats-oauth";

const MAX_WEBHOOK_BYTES = 128_000;
const orderEventTypes = new Set(["orders.notification", "orders.scheduled.notification"]);

const uberWebhookSchema = z.object({
  event_type: z.string().min(1).max(160).regex(/^[a-z][a-z0-9._-]+$/),
  event_id: z.string().min(1).max(200),
  event_time: z.number().int().nonnegative(),
  meta: z.object({
    resource_id: z.string().min(1).max(200),
    user_id: z.string().min(1).max(200),
    status: z.string().max(80).optional(),
  }).passthrough(),
  resource_href: z.string().url().max(2_000).optional(),
}).passthrough();

export function assertUberEatsWebhookConfigured(environment: NodeJS.ProcessEnv = process.env) {
  getUberEatsOAuthConfig(environment);
}

export async function verifyUberEatsWebhook(
  request: Request,
  connection: DeliveryPlatformConnectionContext,
  options: {
    environment?: NodeJS.ProcessEnv;
    resolveSecret?: DeliverySecretResolver;
  } = {},
) {
  if (connection.provider !== "UBER_EATS") throw invalidWebhook();
  const environment = options.environment ?? process.env;
  const config = getUberEatsOAuthConfig(environment, connection.credentialReference);
  const expectedEnvironment = request.headers.get("x-environment")?.trim().toLowerCase();
  if (expectedEnvironment !== config.providerEnvironment) throw invalidWebhook();
  const body = await readWebhookBody(request);
  const suppliedSignature = request.headers.get("x-uber-signature")?.trim() ?? "";
  const resolveSecret = options.resolveSecret
    ?? createEnvironmentDeliverySecretResolver(environment);
  const expectedSignature = createHmac("sha256", resolveSecret(config.webhookReference))
    .update(body)
    .digest("hex");
  if (!constantTimeHexEqual(suppliedSignature, expectedSignature)) throw invalidWebhook();
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    throw invalidWebhook();
  }
  const parsed = uberWebhookSchema.safeParse(decoded);
  if (!parsed.success) throw invalidWebhook();
  const event = parsed.data;
  if (orderEventTypes.has(event.event_type)) validateResourceHref(event, config.apiBaseUrl);
  const payloadHash = sha256(body);
  return {
    provider: "UBER_EATS" as const,
    externalEventId: event.event_id,
    eventType: event.event_type,
    replayKey: sha256(`UBER_EATS:${event.event_id}`),
    payloadHash,
    signatureValid: true as const,
    order: null,
    orderReference: orderEventTypes.has(event.event_type)
      ? {
          externalOrderId: event.meta.resource_id,
          externalStoreId: event.meta.user_id,
        }
      : null,
  };
}

export function parseUberEatsWebhookRoutingHint(payload: unknown) {
  const parsed = uberWebhookSchema.safeParse(payload);
  if (!parsed.success) throw invalidWebhook();
  return {
    externalStoreId: parsed.data.meta.user_id,
    externalOrderId: parsed.data.meta.resource_id,
  };
}

function validateResourceHref(event: z.infer<typeof uberWebhookSchema>, apiBaseUrl: URL) {
  if (!event.resource_href) throw invalidWebhook();
  let resourceUrl: URL;
  try {
    resourceUrl = new URL(event.resource_href);
  } catch {
    throw invalidWebhook();
  }
  if (
    resourceUrl.origin !== apiBaseUrl.origin
    || !resourceUrl.pathname.endsWith(`/v2/eats/order/${encodeURIComponent(event.meta.resource_id)}`)
  ) throw invalidWebhook();
}

async function readWebhookBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].toLowerCase();
  if (contentType !== "application/json") throw invalidWebhook();
  let body: string;
  try {
    body = await readBoundedText(request, MAX_WEBHOOK_BYTES);
  } catch {
    throw invalidWebhook();
  }
  if (body.length === 0) throw invalidWebhook();
  return body;
}

function constantTimeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function invalidWebhook() {
  return new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
}
