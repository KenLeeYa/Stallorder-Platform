import { derivePublicOrderTokens, hmacHex, sha256Hex } from "../_shared/crypto.ts";
import { getAllowedOrigins, requireEnv } from "../_shared/env.ts";
import {
  errorMessage,
  getCorsHeaders,
  getGatewayClientIp,
  HttpInputError,
  jsonResponse,
  readBoundedJson,
  statusForCode,
} from "../_shared/http.ts";
import { createPublicOrderSchema } from "../_shared/schemas.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { verifyTurnstile } from "../_shared/turnstile.ts";

type StoredOrder = {
  order_id: string;
  order_no: string;
  order_status: string;
  payment_status: string;
  total_amount: number;
  fulfillment_type?: string;
  pickup_required?: boolean;
  created_at: string;
};

async function safeRecordSubmissionFailure(
  admin: ReturnType<typeof createServiceClient>,
  values: {
    requestId: string;
    code: string;
    ipHash: string;
    deviceHash: string;
    qrTokenHash: string;
    sessionHash: string;
    behaviorHash: string;
    idempotencyHash: string;
  },
) {
  const { data: context } = await admin.from("order_sessions")
    .select("id, tenant_id, stall_id, qr_code_id")
    .eq("token_hash", values.sessionHash)
    .maybeSingle();
  await admin.rpc("record_public_order_attempt", {
    p_request_id: values.requestId,
    p_event_type: "ORDER_SUBMIT",
    p_outcome: "DENIED",
    p_reason_code: values.code,
    p_tenant_id: context?.tenant_id ?? null,
    p_stall_id: context?.stall_id ?? null,
    p_qr_code_id: context?.qr_code_id ?? null,
    p_order_session_id: context?.id ?? null,
    p_ip_hash: values.ipHash,
    p_device_hash: values.deviceHash,
    p_qr_token_hash: values.qrTokenHash,
    p_order_session_hash: values.sessionHash,
    p_behavior_hash: values.behaviorHash,
    p_idempotency_hash: values.idempotencyHash,
  });
}

function publicOrderResponse(order: StoredOrder, trackingToken: string, pickupCode: string) {
  const pickupRequired = order.pickup_required !== false && order.fulfillment_type !== "DINE_IN";
  return {
    orderNo: order.order_no,
    trackingToken,
    pickupVerificationCode: pickupRequired ? pickupCode : null,
    fulfillmentType: order.fulfillment_type ?? "TAKEOUT",
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    totalAmount: order.total_amount,
    createdAt: order.created_at,
  };
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: Record<string, string> = {};

  try {
    corsHeaders = getCorsHeaders(request, getAllowedOrigins());
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") throw new HttpInputError("METHOD_NOT_ALLOWED", 405);

    const parsed = createPublicOrderSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) throw new HttpInputError("INVALID_REQUEST", 400);
    const input = parsed.data;

    const abuseSecret = requireEnv("ABUSE_HASH_SECRET");
    const tokenSecret = requireEnv("TOKEN_DERIVATION_SECRET");
    const clientIp = getGatewayClientIp(request);
    const sortedBehavior = [...input.items]
      .sort((left, right) => left.productId.localeCompare(right.productId))
      .map((item) => `${item.productId}:${item.quantity}`)
      .join("|");
    const [sessionHash, ipHash, deviceHash, qrTokenHash, behaviorHash, idempotencyHash] = await Promise.all([
      sha256Hex(input.orderSessionToken),
      hmacHex(abuseSecret, `ip:${clientIp}`),
      hmacHex(abuseSecret, `device:${input.deviceId}`),
      hmacHex(abuseSecret, `qr:${input.qrToken}`),
      hmacHex(abuseSecret, `order:${input.deviceId}:${input.qrToken}:${sortedBehavior}`),
      hmacHex(abuseSecret, `idempotency:${input.idempotencyKey}`),
    ]);

    const admin = createServiceClient();
    const { data: globalGateResult, error: globalGateError } = await admin.rpc(
      "check_global_public_request_gate",
      {
        p_scope: "ORDER",
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
      return jsonResponse({ error: errorMessage(code), code }, statusForCode(code), corsHeaders, requestId);
    }

    const { data: existing, error: existingError } = await admin.rpc("lookup_public_order_idempotency", {
      p_session_token_hash: sessionHash,
      p_idempotency_key: input.idempotencyKey,
    });
    if (existingError) throw existingError;
    if (existing) {
      const order = existing as StoredOrder;
      const tokens = await derivePublicOrderTokens(order.order_id, tokenSecret);
      return jsonResponse(publicOrderResponse(order, tokens.trackingToken, tokens.pickupCode), 200, corsHeaders, requestId);
    }

    const { data: gateResult, error: gateError } = await admin.rpc("check_public_order_submission_gate", {
      p_session_token_hash: sessionHash,
      p_ip_hash: ipHash,
      p_device_hash: deviceHash,
      p_qr_token_hash: qrTokenHash,
      p_behavior_hash: behaviorHash,
      p_request_id: requestId,
    });
    if (gateError) throw gateError;
    const gate = gateResult as { ok: boolean; code?: string };
    if (!gate.ok) {
      const code = gate.code ?? "RATE_LIMITED";
      return jsonResponse({ error: errorMessage(code), code }, statusForCode(code), corsHeaders, requestId);
    }

    const turnstile = await verifyTurnstile({
      token: input.turnstileToken,
      remoteIp: clientIp,
      idempotencyKey: crypto.randomUUID(),
      secret: requireEnv("TURNSTILE_SECRET_KEY"),
      expectedHostname: Deno.env.get("TURNSTILE_EXPECTED_HOSTNAME")?.trim() || undefined,
      expectedAction: "public_order",
      allowTestKeys: Deno.env.get("TURNSTILE_ALLOW_TEST_KEYS") === "true",
      environment: Deno.env.get("APP_ENV")?.trim() || "development",
    });
    if (!turnstile.ok) {
      await safeRecordSubmissionFailure(admin, {
        requestId,
        code: turnstile.code,
        ipHash,
        deviceHash,
        qrTokenHash,
        sessionHash,
        behaviorHash,
        idempotencyHash,
      });
      console.warn(JSON.stringify({
        level: "warn",
        event: "TURNSTILE_REJECTED",
        requestId,
        reason: turnstile.code,
        errors: turnstile.errors.slice(0, 5),
      }));
      return jsonResponse(
        { error: errorMessage(turnstile.code), code: turnstile.code },
        statusForCode(turnstile.code),
        corsHeaders,
        requestId,
      );
    }

    const orderId = crypto.randomUUID();
    const provisionalTokens = await derivePublicOrderTokens(orderId, tokenSecret);
    const [trackingTokenHash, pickupCodeHash] = await Promise.all([
      sha256Hex(provisionalTokens.trackingToken),
      sha256Hex(provisionalTokens.pickupCode),
    ]);
    const { data: createResult, error: createError } = await admin.rpc("create_public_order", {
      p_order_id: orderId,
      p_qr_token: input.qrToken,
      p_session_token_hash: sessionHash,
      p_device_hash: deviceHash,
      p_ip_hash: ipHash,
      p_qr_token_hash: qrTokenHash,
      p_behavior_hash: behaviorHash,
      p_idempotency_key: input.idempotencyKey,
      p_idempotency_hash: idempotencyHash,
      p_customer_name: input.customerName,
      p_customer_note: input.customerNote,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        note: item.note,
      })),
      p_tracking_token_hash: trackingTokenHash,
      p_pickup_code_hash: pickupCodeHash,
      p_request_id: requestId,
    });
    if (createError) {
      if (createError.message.includes("TOO_MANY_PENDING_ORDERS")) {
        const code = "TOO_MANY_PENDING_ORDERS";
        await safeRecordSubmissionFailure(admin, {
          requestId,
          code,
          ipHash,
          deviceHash,
          qrTokenHash,
          sessionHash,
          behaviorHash,
          idempotencyHash,
        });
        return jsonResponse(
          { error: errorMessage(code), code },
          statusForCode(code),
          corsHeaders,
          requestId,
        );
      }
      throw createError;
    }

    const result = createResult as { ok: boolean; code?: string; idempotent_replay?: boolean; order?: StoredOrder };
    if (!result.ok || !result.order) {
      const code = result.code ?? "ORDER_CREATE_ERROR";
      return jsonResponse({ error: errorMessage(code), code }, statusForCode(code), corsHeaders, requestId);
    }

    const finalTokens = result.order.order_id === orderId
      ? provisionalTokens
      : await derivePublicOrderTokens(result.order.order_id, tokenSecret);
    return jsonResponse(
      publicOrderResponse(result.order, finalTokens.trackingToken, finalTokens.pickupCode),
      result.idempotent_replay ? 200 : 201,
      corsHeaders,
      requestId,
    );
  } catch (error) {
    const code = error instanceof HttpInputError ? error.code : "ORDER_CREATE_ERROR";
    const status = error instanceof HttpInputError ? error.status : 500;
    if (!(error instanceof HttpInputError)) {
      const detail = error && typeof error === "object" && "message" in error
        ? String(error.message).replace(/[\r\n]/g, " ").slice(0, 300)
        : "unknown";
      console.error(JSON.stringify({
        level: "error",
        event: "PUBLIC_ORDER_EDGE_FAILED",
        requestId,
        detail,
      }));
    }
    return jsonResponse({ error: errorMessage(code), code }, status, corsHeaders, requestId);
  }
});
