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
  assertSupportedPublicOrderProtocol,
} from "../_shared/http.ts";
import { createPublicOrderSchema } from "../_shared/schemas.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { verifyTurnstile } from "../_shared/turnstile.ts";
import { createEdgePerformanceTiming, finalizeEdgeResponse } from "../_shared/performance.ts";

type StoredOrder = {
  order_id: string;
  order_no: string;
  order_status: string;
  payment_status: string;
  total_amount: number;
  fulfillment_type?: string;
  pickup_required?: boolean;
  quoted_wait_minutes?: number | null;
  quoted_ready_at?: string | null;
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
  const fulfillmentType = order.fulfillment_type ?? "TAKEOUT";
  const pickupRequired = order.pickup_required === true
    || (order.pickup_required === undefined && fulfillmentType === "TAKEOUT");
  return {
    orderNo: order.order_no,
    trackingToken,
    pickupVerificationCode: pickupRequired ? pickupCode : null,
    fulfillmentType,
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    totalAmount: order.total_amount,
    quotedWaitMinutes: order.quoted_wait_minutes ?? null,
    quotedReadyAt: order.quoted_ready_at ?? null,
    createdAt: order.created_at,
  };
}

async function persistPickupCodeDisplay(
  admin: ReturnType<typeof createServiceClient>,
  order: StoredOrder,
  pickupCode: string,
) {
  const fulfillmentType = order.fulfillment_type ?? "TAKEOUT";
  const pickupRequired = order.pickup_required === true
    || (order.pickup_required === undefined && fulfillmentType === "TAKEOUT");
  if (!pickupRequired) return;
  const { error } = await admin.from("orders")
    .update({ pickup_code_display: pickupCode })
    .eq("id", order.order_id);
  if (error) throw error;
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const timing = createEdgePerformanceTiming({ route: "/functions/v1/create-public-order", requestId });
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
    assertSupportedPublicOrderProtocol(request);

    const parsed = createPublicOrderSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) throw new HttpInputError("INVALID_REQUEST", 400);
    const input = parsed.data;

    const abuseSecret = requireEnv("ABUSE_HASH_SECRET");
    const tokenSecret = requireEnv("TOKEN_DERIVATION_SECRET");
    const clientIp = getGatewayClientIp(request);
    const sortedBehavior = [...input.items]
      .sort((left, right) => left.productId.localeCompare(right.productId))
      .map((item) => `${item.productId}:${item.quantity}:${[...item.noteOptionIds].sort().join(",")}`)
      .join("|");
    const [sessionHash, ipHash, deviceHash, qrTokenHash, behaviorHash, idempotencyHash] = await Promise.all([
      sha256Hex(input.orderSessionToken),
      hmacHex(abuseSecret, `ip:${clientIp}`),
      hmacHex(abuseSecret, `device:${input.deviceId}`),
      hmacHex(abuseSecret, `qr:${input.qrToken}`),
      hmacHex(abuseSecret, `order:${input.orderingMode}:${input.deviceId}:${input.qrToken}:${sortedBehavior}`),
      hmacHex(abuseSecret, `idempotency:${input.idempotencyKey}`),
    ]);

    const admin = createServiceClient();
    const { data: globalGateResult, error: globalGateError } = await timing.measureDb(() => admin.rpc(
      "check_global_public_request_gate",
      {
        p_scope: "ORDER",
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
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }

    const { data: sessionContext, error: sessionContextError } = await timing.measureDb(() => admin.from("order_sessions")
      .select("ordering_mode")
      .eq("token_hash", sessionHash)
      .maybeSingle());
    if (sessionContextError) throw sessionContextError;
    if (!sessionContext) {
      const code = "SESSION_NOT_FOUND";
      await timing.measureDb(() => safeRecordSubmissionFailure(admin, {
        requestId, code, ipHash, deviceHash, qrTokenHash, sessionHash, behaviorHash, idempotencyHash,
      }));
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }
    if (sessionContext.ordering_mode !== input.orderingMode) {
      const code = "ORDER_MODE_CONFLICT";
      await timing.measureDb(() => safeRecordSubmissionFailure(admin, {
        requestId, code, ipHash, deviceHash, qrTokenHash, sessionHash, behaviorHash, idempotencyHash,
      }));
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }

    const { data: existing, error: existingError } = await timing.measureDb(() => admin.rpc("lookup_public_order_idempotency", {
      p_session_token_hash: sessionHash,
      p_idempotency_key: input.idempotencyKey,
    }));
    if (existingError) throw existingError;
    if (existing) {
      const order = existing as StoredOrder;
      const { data: quote, error: quoteError } = await timing.measureDb(() => admin.from("orders")
        .select("quoted_wait_minutes, quoted_ready_at")
        .eq("id", order.order_id)
        .single());
      if (quoteError) throw quoteError;
      order.quoted_wait_minutes = quote.quoted_wait_minutes;
      order.quoted_ready_at = quote.quoted_ready_at;
      const tokens = await derivePublicOrderTokens(order.order_id, tokenSecret);
      await timing.measureDb(() => persistPickupCodeDisplay(admin, order, tokens.pickupCode));
      return respond(publicOrderResponse(order, tokens.trackingToken, tokens.pickupCode), 200);
    }

    const { data: gateResult, error: gateError } = await timing.measureDb(() => admin.rpc("check_public_order_submission_gate", {
      p_session_token_hash: sessionHash,
      p_ip_hash: ipHash,
      p_device_hash: deviceHash,
      p_qr_token_hash: qrTokenHash,
      p_behavior_hash: behaviorHash,
      p_request_id: requestId,
    }));
    if (gateError) throw gateError;
    const gate = gateResult as { ok: boolean; code?: string };
    if (!gate.ok) {
      const code = gate.code ?? "RATE_LIMITED";
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }

    const turnstile = await timing.measure("turnstileMs", () => verifyTurnstile({
      token: input.turnstileToken,
      remoteIp: clientIp,
      idempotencyKey: input.turnstileIdempotencyKey ?? crypto.randomUUID(),
      secret: requireEnv("TURNSTILE_SECRET_KEY"),
      expectedHostname: Deno.env.get("TURNSTILE_EXPECTED_HOSTNAME")?.trim() || undefined,
      expectedAction: "public_order",
      allowTestKeys: Deno.env.get("TURNSTILE_ALLOW_TEST_KEYS") === "true",
      environment: Deno.env.get("APP_ENV")?.trim() || "development",
    }));
    if (!turnstile.ok) {
      await timing.measureDb(() => safeRecordSubmissionFailure(admin, {
        requestId,
        code: turnstile.code,
        ipHash,
        deviceHash,
        qrTokenHash,
        sessionHash,
        behaviorHash,
        idempotencyHash,
      }));
      console.warn(JSON.stringify({
        level: "warn",
        event: "TURNSTILE_REJECTED",
        requestId,
        reason: turnstile.code,
        errors: turnstile.errors.slice(0, 5),
      }));
      return respond(
        { error: errorMessage(turnstile.code), code: turnstile.code },
        statusForCode(turnstile.code),
      );
    }

    const orderId = input.clientOrderId ?? crypto.randomUUID();
    const provisionalTokens = await derivePublicOrderTokens(orderId, tokenSecret);
    const [trackingTokenHash, pickupCodeHash] = await Promise.all([
      sha256Hex(provisionalTokens.trackingToken),
      sha256Hex(provisionalTokens.pickupCode),
    ]);
    const createArguments = {
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
        modifier_option_ids: item.noteOptionIds,
      })),
      p_tracking_token_hash: trackingTokenHash,
      p_pickup_code_hash: pickupCodeHash,
      p_request_id: requestId,
      p_wait_acknowledged: input.waitAcknowledged,
      ...(input.orderingMode === "DELIVERY" ? {
        p_customer_phone: input.customerPhone,
        p_delivery_address: input.deliveryAddress,
      } : {}),
    };
    const { data: createResult, error: createError } = await timing.measureDb(() => admin.rpc(
      input.orderingMode === "DELIVERY"
        ? "create_public_delivery_order_with_schedule"
        : "create_public_order_with_schedule",
      createArguments,
    ));
    if (createError) {
      if (createError.message.includes("TOO_MANY_PENDING_ORDERS")) {
        const code = "TOO_MANY_PENDING_ORDERS";
        await timing.measureDb(() => safeRecordSubmissionFailure(admin, {
          requestId,
          code,
          ipHash,
          deviceHash,
          qrTokenHash,
          sessionHash,
          behaviorHash,
          idempotencyHash,
        }));
        return respond(
          { error: errorMessage(code), code },
          statusForCode(code),
        );
      }
      throw createError;
    }

    const result = createResult as {
      ok: boolean;
      code?: string;
      idempotent_replay?: boolean;
      order?: StoredOrder;
      capacity?: {
        quote_min_minutes?: number;
        quote_max_minutes?: number;
        requires_acknowledgment?: boolean;
      };
    };
    if (!result.ok || !result.order) {
      const code = result.code ?? "ORDER_CREATE_ERROR";
      return respond({
        error: errorMessage(code),
        code,
        ...(result.capacity ? {
          capacity: {
            estimatedWaitMinMinutes: result.capacity.quote_min_minutes ?? null,
            estimatedWaitMaxMinutes: result.capacity.quote_max_minutes ?? null,
            requiresWaitAcknowledgment:
              result.capacity.requires_acknowledgment === true,
          },
        } : {}),
      }, statusForCode(code));
    }

    const finalTokens = result.order.order_id === orderId
      ? provisionalTokens
      : await derivePublicOrderTokens(result.order.order_id, tokenSecret);
    await timing.measureDb(() => persistPickupCodeDisplay(admin, result.order!, finalTokens.pickupCode));
    return respond(
      publicOrderResponse(result.order, finalTokens.trackingToken, finalTokens.pickupCode),
      result.idempotent_replay ? 200 : 201,
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
    return respond({ error: errorMessage(code), code }, status);
  }
});
