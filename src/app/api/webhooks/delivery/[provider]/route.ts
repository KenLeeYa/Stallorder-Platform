import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import { deliveryApiErrorResponse } from "@/server/delivery-platforms/delivery-http";
import { parseDeliveryProvider } from "@/server/delivery-platforms/delivery-platform-types";
import { processDeliveryWebhook } from "@/server/delivery-platforms/webhook-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { provider: providerPath } = await context.params;
  const provider = parseDeliveryProvider(providerPath.replaceAll("-", "_"));
  const connectionId = request.headers.get("x-stallorder-delivery-connection")?.trim() ?? "";
  if (!provider || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
    return webhookJson({ accepted: false }, 400);
  }
  const rateLimit = await checkRateLimit({
    scope: "delivery-webhook",
    identifier: `${provider}:${connectionId}:${hashClientIp(request)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return webhookJson(
      { accepted: false },
      429,
      { "retry-after": String(rateLimit.retryAfterSeconds) },
    );
  }
  try {
    const result = await processDeliveryWebhook({
      provider,
      connectionId,
      request,
      circuit: "CIRCUIT_B_VERCEL",
    });
    return webhookJson(
      { accepted: true, duplicate: result.duplicate },
      result.duplicate ? 200 : 202,
    );
  } catch (error) {
    const response = deliveryApiErrorResponse(error);
    if (response) {
      const status = response.status >= 500 ? 503 : response.status;
      return webhookJson({ accepted: false }, status);
    }
    return webhookJson({ accepted: false }, 503);
  }
}

function webhookJson(
  body: unknown,
  status: number,
  additionalHeaders: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...additionalHeaders,
    },
  });
}
