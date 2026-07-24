import { derivePublicOrderTokens, hmacHex, sha256Hex } from "../_shared/crypto.ts";
import { getAllowedOrigins, requireEnv } from "../_shared/env.ts";
import {
  errorMessage,
  getCorsHeaders,
  getGatewayClientIp,
  HttpInputError,
  jsonResponse,
  readBoundedJson,
} from "../_shared/http.ts";
import { getPublicOrderSchema } from "../_shared/schemas.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { createEdgePerformanceTiming, finalizeEdgeResponse } from "../_shared/performance.ts";

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const timing = createEdgePerformanceTiming({ route: "/functions/v1/get-public-order", requestId });
  let corsHeaders: Record<string, string> = {};
  const respond = (body: unknown, status: number) => finalizeEdgeResponse(
    jsonResponse(body, status, corsHeaders, requestId),
    timing,
  );

  try {
    corsHeaders = getCorsHeaders(request, getAllowedOrigins());
    if (request.method === "OPTIONS") {
      return finalizeEdgeResponse(new Response(null, { status: 204, headers: corsHeaders }), timing);
    }
    if (request.method !== "POST") throw new HttpInputError("METHOD_NOT_ALLOWED", 405);

    const parsed = getPublicOrderSchema.safeParse(await readBoundedJson(request, 8_000));
    if (!parsed.success) throw new HttpInputError("INVALID_REQUEST", 400);
    const trackingHash = await sha256Hex(parsed.data.trackingToken);
    const abuseSecret = requireEnv("ABUSE_HASH_SECRET");
    const [ipHash, deviceHash, behaviorHash] = await Promise.all([
      hmacHex(abuseSecret, `ip:${getGatewayClientIp(request)}`),
      hmacHex(abuseSecret, `device:${parsed.data.deviceId}`),
      hmacHex(abuseSecret, `tracking:${trackingHash}`),
    ]);

    const admin = createServiceClient();
    const { data: globalGateResult, error: globalGateError } = await timing.measureDb(() => admin.rpc(
      "check_global_public_request_gate",
      {
        p_scope: "TRACKING",
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
      },
    ));
    if (globalGateError) throw globalGateError;
    const globalGate = globalGateResult as { ok: boolean; code?: string };
    if (!globalGate.ok) {
      const code = globalGate.code ?? "RATE_LIMITED";
      return respond({ error: errorMessage(code), code }, 429);
    }

    const { data, error } = await timing.measureDb(() => admin.rpc("get_public_order", {
      p_tracking_token_hash: trackingHash,
      p_device_hash: deviceHash,
    }));
    if (error) throw error;
    if (!data) {
      await timing.measureDb(() => admin.rpc("record_public_order_attempt", {
        p_request_id: requestId,
        p_event_type: "TRACKING_READ",
        p_outcome: "DENIED",
        p_reason_code: "ORDER_NOT_FOUND",
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_order_session_hash: trackingHash,
      }));
      return respond({ error: errorMessage("ORDER_NOT_FOUND"), code: "ORDER_NOT_FOUND" }, 404);
    }
    const stored = data as Record<string, unknown> & {
      orderId: string;
      fulfillmentType?: string;
      pickupCodeLength?: number;
    };
    const pickupCode = stored.fulfillmentType === "TAKEOUT"
      ? (await derivePublicOrderTokens(
        stored.orderId,
        requireEnv("TOKEN_DERIVATION_SECRET"),
        stored.pickupCodeLength === 6 ? 6 : 3,
      )).pickupCode
      : null;
    const orderContext = await timing.measureDb(() => admin.from("orders")
      .select("stall_id, dining_table_id, quoted_wait_minutes, quoted_ready_at")
      .eq("id", stored.orderId)
      .single());
    if (orderContext.error) throw orderContext.error;
    const [settingsQuery, lastTableOrderQuery] = await timing.measureDb(() => Promise.all([
      admin.from("stall_ordering_settings")
        .select("estimated_wait_minutes")
        .eq("stall_id", orderContext.data.stall_id)
        .single(),
      orderContext.data.dining_table_id
        ? admin.from("orders")
          .select("created_at")
          .eq("stall_id", orderContext.data.stall_id)
          .eq("dining_table_id", orderContext.data.dining_table_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]), orderContext.data.dining_table_id ? 2 : 1);
    if (settingsQuery.error || lastTableOrderQuery.error) {
      throw settingsQuery.error ?? lastTableOrderQuery.error;
    }
    const publicOrder: Record<string, unknown> = { ...stored };
    delete publicOrder.orderId;
    delete publicOrder.pickupCodeLength;
    return respond({
      order: {
        ...publicOrder,
        pickupVerificationCode: pickupCode,
        estimatedWaitMinutes:
          orderContext.data.quoted_wait_minutes ?? settingsQuery.data.estimated_wait_minutes,
        quotedWaitMinutes: orderContext.data.quoted_wait_minutes,
        quotedReadyAt: orderContext.data.quoted_ready_at,
        lastTableOrderAt: lastTableOrderQuery.data?.created_at ?? null,
      },
    }, 200);
  } catch (error) {
    const code = error instanceof HttpInputError ? error.code : "ORDER_CREATE_ERROR";
    const status = error instanceof HttpInputError ? error.status : 500;
    if (!(error instanceof HttpInputError)) {
      const detail = error && typeof error === "object" && "message" in error
        ? String(error.message).replace(/[\r\n]/g, " ").slice(0, 300)
        : "unknown";
      console.error(JSON.stringify({
        level: "error",
        event: "PUBLIC_ORDER_LOOKUP_FAILED",
        requestId,
        detail,
      }));
    }
    return respond({ error: errorMessage(code), code }, status);
  }
});
