import "server-only";

import { publicOrderUpstreamIpHeaders } from "@/lib/public-order-proxy-headers";
import { PUBLIC_ORDER_OPERATION_ID_HEADER } from "@/lib/public-order-operation-id";

const PUBLIC_ORDER_PROTOCOL_VERSION = "1";
const CANONICAL_VALIDATION_TIMEOUT_MS = 4_000;

export type CanonicalTrackingValidation =
  | { outcome: "AUTHORIZED" }
  | { outcome: "NOT_FOUND" }
  | { outcome: "UNAVAILABLE" };

function functionsBaseUrl() {
  return (
    process.env.SUPABASE_FUNCTIONS_URL
    || process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
    || "http://127.0.0.1:54321/functions/v1"
  ).trim().replace(/\/$/, "");
}

function functionOrigin() {
  const configured = process.env.PUBLIC_ORDER_FUNCTION_ORIGIN || process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return "https://app.qidaigo.com";
  return new URL(configured).origin;
}

function gatewayHeaders() {
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_MISSING");
  return {
    apikey: publishableKey,
    authorization: `Bearer ${publishableKey}`,
  };
}

export async function validateTrackedPublicOrderAtCanonicalEdge(input: {
  trackingToken: string;
  deviceId: string;
  clientIp: string;
  operationId: string;
  fetchImpl?: typeof fetch;
}): Promise<CanonicalTrackingValidation> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${functionsBaseUrl()}/get-public-order`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stallorder-protocol-version": PUBLIC_ORDER_PROTOCOL_VERSION,
        [PUBLIC_ORDER_OPERATION_ID_HEADER]: input.operationId,
        origin: functionOrigin(),
        ...gatewayHeaders(),
        ...publicOrderUpstreamIpHeaders(input.clientIp),
      },
      body: JSON.stringify({
        trackingToken: input.trackingToken,
        deviceId: input.deviceId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(CANONICAL_VALIDATION_TIMEOUT_MS),
    });
    if (response.status === 404) return { outcome: "NOT_FOUND" };
    if (!response.ok) return { outcome: "UNAVAILABLE" };
    const payload = await response.json().catch(() => null) as { order?: unknown } | null;
    return payload?.order && typeof payload.order === "object"
      ? { outcome: "AUTHORIZED" }
      : { outcome: "UNAVAILABLE" };
  } catch {
    return { outcome: "UNAVAILABLE" };
  }
}
