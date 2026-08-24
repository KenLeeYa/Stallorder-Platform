import "server-only";

import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import { deliveryApiErrorResponse } from "./delivery-http";
import type { DeliveryProvider } from "./delivery-platform-types";
import { processDeliveryWebhook } from "./webhook-service";
import { resolveCanonicalDeliveryWebhook } from "./webhook-routing";

export async function handleCanonicalDeliveryWebhook(
  provider: Exclude<DeliveryProvider, "MOCK">,
  request: Request,
) {
  const rateLimit = await checkRateLimit({
    scope: "delivery-webhook",
    identifier: `${provider}:canonical:${hashClientIp(request)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return emptyWebhookResponse(429, { "retry-after": String(rateLimit.retryAfterSeconds) });
  }
  try {
    const resolved = await resolveCanonicalDeliveryWebhook({ provider, request });
    await processDeliveryWebhook({
      provider,
      connectionId: resolved.connectionId,
      request: resolved.request,
      circuit: "CIRCUIT_B_VERCEL",
    });
    return emptyWebhookResponse(200);
  } catch (error) {
    const response = deliveryApiErrorResponse(error);
    if (!response) return emptyWebhookResponse(503);
    const status = response.status >= 500 ? 503 : response.status;
    return emptyWebhookResponse(status);
  }
}

function emptyWebhookResponse(status: number, additionalHeaders: Record<string, string> = {}) {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...additionalHeaders,
    },
  });
}
