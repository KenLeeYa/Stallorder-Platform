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

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: Record<string, string> = {};

  try {
    corsHeaders = getCorsHeaders(request, getAllowedOrigins());
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
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
    const { data: globalGateResult, error: globalGateError } = await admin.rpc(
      "check_global_public_request_gate",
      {
        p_scope: "TRACKING",
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
      },
    );
    if (globalGateError) throw globalGateError;
    const globalGate = globalGateResult as { ok: boolean; code?: string };
    if (!globalGate.ok) {
      const code = globalGate.code ?? "RATE_LIMITED";
      return jsonResponse({ error: errorMessage(code), code }, 429, corsHeaders, requestId);
    }

    await admin.rpc("expire_unconfirmed_orders");
    const { data, error } = await admin.rpc("get_public_order", {
      p_tracking_token_hash: trackingHash,
      p_device_hash: deviceHash,
    });
    if (error) throw error;
    if (!data) {
      await admin.rpc("record_public_order_attempt", {
        p_request_id: requestId,
        p_event_type: "TRACKING_READ",
        p_outcome: "DENIED",
        p_reason_code: "ORDER_NOT_FOUND",
        p_ip_hash: ipHash,
        p_device_hash: deviceHash,
        p_order_session_hash: trackingHash,
      });
      return jsonResponse({ error: errorMessage("ORDER_NOT_FOUND"), code: "ORDER_NOT_FOUND" }, 404, corsHeaders, requestId);
    }
    const stored = data as Record<string, unknown> & {
      orderId: string;
      fulfillmentType?: string;
      pickupCodeLength?: number;
    };
    const pickupCode = stored.fulfillmentType === "DINE_IN"
      ? null
      : (await derivePublicOrderTokens(
        stored.orderId,
        requireEnv("TOKEN_DERIVATION_SECRET"),
        stored.pickupCodeLength === 6 ? 6 : 3,
      )).pickupCode;
    const orderContext = await admin.from("orders")
      .select("stall_id, dining_table_id")
      .eq("id", stored.orderId)
      .single();
    if (orderContext.error) throw orderContext.error;
    const settingsQuery = await admin.from("stall_ordering_settings")
      .select("estimated_wait_minutes")
      .eq("stall_id", orderContext.data.stall_id)
      .single();
    if (settingsQuery.error) throw settingsQuery.error;
    const lastTableOrderQuery = orderContext.data.dining_table_id
      ? await admin.from("orders")
        .select("created_at")
        .eq("stall_id", orderContext.data.stall_id)
        .eq("dining_table_id", orderContext.data.dining_table_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      : { data: null, error: null };
    if (lastTableOrderQuery.error) throw lastTableOrderQuery.error;
    const publicOrder: Record<string, unknown> = { ...stored };
    delete publicOrder.orderId;
    delete publicOrder.pickupCodeLength;
    return jsonResponse({
      order: {
        ...publicOrder,
        pickupVerificationCode: pickupCode,
        estimatedWaitMinutes: settingsQuery.data.estimated_wait_minutes,
        lastTableOrderAt: lastTableOrderQuery.data?.created_at ?? null,
      },
    }, 200, corsHeaders, requestId);
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
    return jsonResponse({ error: errorMessage(code), code }, status, corsHeaders, requestId);
  }
});
