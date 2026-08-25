import { derivePublicOrderTokens, hmacHex, sha256Hex } from "../_shared/crypto.ts";
import { getAllowedOrigins, requireEnv } from "../_shared/env.ts";
import {
  errorMessage,
  getCorsHeaders,
  getGatewayClientIp,
  getPublicOrderOperationId,
  HttpInputError,
  jsonResponse,
  readBoundedJson,
  statusForCode,
  assertSupportedPublicOrderProtocol,
} from "../_shared/http.ts";
import {
  canonicalPublicOrderBehavior,
  createPublicOrderSchema,
  createPublicOrderValidationCode,
  publicOrderCustomerDetailsCode,
  resolvePublicOrderFulfillmentType,
} from "../_shared/schemas.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { verifyTurnstile } from "../_shared/turnstile.ts";
import { createEdgePerformanceTiming, finalizeEdgeResponse } from "../_shared/performance.ts";
import { canonicalPublicOrderTimestamp } from "../_shared/public-order-replay.ts";
import {
  buildPublicOrderFailureBody,
  buildPublicOrderResponse,
  publicOrderItemsToRpc,
  publicOrderNeedsPickupCode,
  publicOrderSubmissionAbuseBehavior,
  type StoredPublicOrderContract,
} from "../_shared/public-order-contract.ts";
import { deriveCreatePublicOrderReplayTokens } from "./replay.ts";

type StoredOrder = StoredPublicOrderContract;

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

async function persistPickupCodeDisplay(
  admin: ReturnType<typeof createServiceClient>,
  order: StoredOrder,
  pickupCode: string,
) {
  if (!publicOrderNeedsPickupCode(order)) return;
  const { error } = await admin.from("orders")
    .update({ pickup_code_display: pickupCode })
    .eq("id", order.order_id);
  if (error) throw error;
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const operationId = getPublicOrderOperationId(request);
  const timing = createEdgePerformanceTiming({
    route: "/functions/v1/create-public-order",
    requestId,
    operationId,
  });
  let corsHeaders: Record<string, string> = {};
  const respond = (body: unknown, status: number) => finalizeEdgeResponse(
    jsonResponse(body, status, corsHeaders, requestId, operationId),
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
    if (!parsed.success) {
      const code = createPublicOrderValidationCode(parsed.error);
      throw new HttpInputError(code, statusForCode(code));
    }
    const input = parsed.data;

    const abuseSecret = requireEnv("ABUSE_HASH_SECRET");
    const tokenSecret = requireEnv("TOKEN_DERIVATION_SECRET");
    const clientIp = getGatewayClientIp(request);
    const sortedBehavior = canonicalPublicOrderBehavior(input.items);
    const [sessionHash, ipHash, deviceHash, qrTokenHash, behaviorHash, idempotencyHash] = await Promise.all([
      sha256Hex(input.orderSessionToken),
      hmacHex(abuseSecret, `ip:${clientIp}`),
      hmacHex(abuseSecret, `device:${input.deviceId}`),
      hmacHex(abuseSecret, `qr:${input.qrToken}`),
      hmacHex(abuseSecret, publicOrderSubmissionAbuseBehavior({
        orderingMode: input.orderingMode,
        deviceId: input.deviceId,
        qrToken: input.qrToken,
        scheduledPickupAt: input.scheduledPickupAt,
        lotteryDrawId: input.lotteryDrawId,
        canonicalItems: sortedBehavior,
      })),
      hmacHex(abuseSecret, `idempotency:${input.idempotencyKey}`),
    ]);

    const admin = createServiceClient();
    const { data: intakeResult, error: intakeError } = await timing.measureDb(() => admin.rpc(
      "check_public_order_intake_availability",
      {
        p_qr_token: input.qrToken,
        p_device_id: input.deviceId,
      },
    ));
    if (intakeError) throw intakeError;
    const intake = intakeResult as { ok: boolean; code?: string };
    if (!intake.ok && intake.code === "QR_ORDERING_UNAVAILABLE") {
      const code = intake.code;
      return respond({ error: errorMessage(code), code }, statusForCode(code));
    }

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

    const preflightItems = publicOrderItemsToRpc(input.items);
    const { data: preflightResult, error: preflightError } = await timing.measureDb(() => admin.rpc(
      "public_order_preflight_with_special_closure",
      {
        p_scope: "ORDER",
        p_qr_token: input.qrToken,
        p_ordering_mode: input.orderingMode,
        p_device_hash: deviceHash,
        p_ip_hash: ipHash,
        p_qr_token_hash: qrTokenHash,
        p_behavior_hash: behaviorHash,
        p_request_id: requestId,
        p_session_token_hash: sessionHash,
        p_idempotency_key: input.idempotencyKey,
        p_idempotency_hash: idempotencyHash,
        p_requested_fulfillment_at: input.scheduledPickupAt,
        p_lottery_draw_id: input.lotteryDrawId,
        p_items: preflightItems,
        p_wait_acknowledged: input.waitAcknowledged,
        p_intake_code: intake.ok ? null : intake.code ?? "QR_ORDERING_UNAVAILABLE",
      },
    ));
    if (preflightError) throw preflightError;
    const preflight = preflightResult as {
      ok: boolean;
      code?: string;
      capacity?: {
        quote_min_minutes?: number;
        quote_max_minutes?: number;
        requires_acknowledgment?: boolean;
      };
      qr_context?: {
        dining_table_id?: string | null;
        fulfillment_type_context?: string | null;
      } | null;
      idempotent_order?: (StoredOrder & {
        lottery_draw_id?: string | null;
        pickup_code_length?: number | null;
      }) | null;
    };
    if (!preflight.ok) {
      const code = preflight.code ?? "ORDER_CREATE_ERROR";
      return respond(
        buildPublicOrderFailureBody(code, errorMessage(code), preflight.capacity),
        statusForCode(code),
      );
    }

    const existing = preflight.idempotent_order;
    if (existing) {
      const tokens = await deriveCreatePublicOrderReplayTokens(existing.order_id, tokenSecret, existing);
      await timing.measureDb(() => persistPickupCodeDisplay(admin, existing, tokens.pickupCode));
      return respond(buildPublicOrderResponse(
        existing,
        tokens.trackingToken,
        tokens.pickupCode,
        canonicalPublicOrderTimestamp(existing.created_at),
      ), 200);
    }

    const customerDetailsCode = publicOrderCustomerDetailsCode(
      input,
      resolvePublicOrderFulfillmentType(input.orderingMode, preflight.qr_context),
    );
    if (customerDetailsCode) {
      return respond(
        { error: errorMessage(customerDetailsCode), code: customerDetailsCode },
        statusForCode(customerDetailsCode),
      );
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
        operationId,
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
      p_customer_phone: input.customerPhone,
      p_delivery_address: input.deliveryAddress,
      p_customer_note: input.customerNote,
      p_items: preflightItems,
      p_tracking_token_hash: trackingTokenHash,
      p_pickup_code_hash: pickupCodeHash,
      p_request_id: requestId,
      p_wait_acknowledged: input.waitAcknowledged,
      p_requested_fulfillment_at: input.scheduledPickupAt,
      p_lottery_draw_id: input.lotteryDrawId,
    };
    const { data: createResult, error: createError } = await timing.measureDb(() => admin.rpc(
      "create_public_order_with_free_lottery_reward_targeted",
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
      return respond(
        buildPublicOrderFailureBody(code, errorMessage(code), result.capacity),
        statusForCode(code),
      );
    }

    const finalTokens = result.order.order_id === orderId
      ? provisionalTokens
      : await derivePublicOrderTokens(result.order.order_id, tokenSecret);
    await timing.measureDb(() => persistPickupCodeDisplay(admin, result.order!, finalTokens.pickupCode));
    return respond(
      buildPublicOrderResponse(
        result.order,
        finalTokens.trackingToken,
        finalTokens.pickupCode,
        canonicalPublicOrderTimestamp(result.order.created_at),
      ),
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
        operationId,
        detail,
      }));
    }
    return respond({ error: errorMessage(code), code }, status);
  }
});
