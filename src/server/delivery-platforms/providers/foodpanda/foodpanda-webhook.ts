import { createHash, timingSafeEqual } from "node:crypto";
import { readBoundedText } from "../../bounded-text-reader";
import { DeliveryPlatformError } from "../../delivery-platform-errors";
import {
  createEnvironmentDeliverySecretResolver,
  type DeliverySecretResolver,
} from "../../delivery-secret-resolver";
import type { DeliveryPlatformConnectionContext } from "../../delivery-platform-types";
import { getFoodpandaPartnerConfig } from "./foodpanda-auth";
import { normalizeFoodpandaOrder, parseFoodpandaOrder } from "./foodpanda-normalizer";

const MAX_WEBHOOK_BYTES = 128_000;

export function assertFoodpandaWebhookConfigured(environment: NodeJS.ProcessEnv = process.env) {
  getFoodpandaPartnerConfig(environment);
}

export async function verifyFoodpandaWebhook(
  request: Request,
  connection: DeliveryPlatformConnectionContext,
  options: {
    environment?: NodeJS.ProcessEnv;
    resolveSecret?: DeliverySecretResolver;
  } = {},
) {
  if (connection.provider !== "FOODPANDA") throw invalidWebhook();
  const environment = options.environment ?? process.env;
  const config = getFoodpandaPartnerConfig(environment, connection.credentialReference);
  const resolveSecret = options.resolveSecret
    ?? createEnvironmentDeliverySecretResolver(environment);
  const expectedAuthorization = resolveSecret(config.webhookReference);
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!constantTimeTextEqual(authorization, expectedAuthorization)) throw invalidWebhook();
  const body = await readWebhookBody(request);
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    throw invalidWebhook();
  }
  let providerOrder: ReturnType<typeof parseFoodpandaOrder>;
  try {
    providerOrder = parseFoodpandaOrder(decoded);
  } catch {
    throw invalidWebhook();
  }
  const eventType = normalizeFoodpandaStatus(providerOrder.status);
  const payloadHash = sha256(body);
  const eventFingerprint = [
    providerOrder.order_id,
    eventType,
    providerOrder.sys.updated_at ?? providerOrder.sys.created_at,
    payloadHash,
  ].join(":");
  return {
    provider: "FOODPANDA" as const,
    externalEventId: null,
    eventType,
    replayKey: sha256(`FOODPANDA:${eventFingerprint}`),
    payloadHash,
    signatureValid: true as const,
    order: normalizeFoodpandaOrder(decoded, config.currency),
    orderReference: null,
  };
}

function normalizeFoodpandaStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "CANCELED") return "CANCELLED";
  if (["RECEIVED", "READY_FOR_PICKUP", "DISPATCHED", "CANCELLED", "DELIVERED"].includes(normalized)) {
    return normalized;
  }
  throw invalidWebhook();
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

function constantTimeTextEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash) && left.length === right.length;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function invalidWebhook() {
  return new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
}
