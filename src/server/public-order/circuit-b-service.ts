import "server-only";

import { randomUUID } from "node:crypto";
import type { createPerformanceTiming } from "@/lib/performance-timing";
import { getCachedPublicMenuForQrToken } from "@/lib/public-menu";
import {
  resolveFulfillmentTimeReadModel,
  type FulfillmentTimeState,
} from "@/lib/fulfillment-time";
import {
  deriveOrderSessionToken,
  derivePublicOrderTokens,
  hmacHex,
  sha256Hex,
} from "../../../supabase/functions/_shared/crypto";
import {
  canonicalPublicOrderBehavior,
  type GetPublicOrderInput,
  type IssueOrderSessionInput,
  type PublicOrderInput,
} from "../../../supabase/functions/_shared/schemas";
import { verifyTurnstile } from "../../../supabase/functions/_shared/turnstile";
import { statusForCode } from "../../../supabase/functions/_shared/public-order-errors";
import {
  canonicalPublicOrderTimestamp,
  publicOrderReplayPickupCodeLength,
} from "../../../supabase/functions/_shared/public-order-replay";
import {
  buildPublicOrderCapacityDetails,
  buildPublicOrderResponse,
  buildPublicOrderResumeResponse,
  buildPublicOrderSessionResponse,
  publicOrderItemsToRpc,
  publicOrderNeedsPickupCode,
  publicOrderSessionAbuseBehavior,
  publicOrderSubmissionAbuseBehavior,
} from "../../../supabase/functions/_shared/public-order-contract";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";
import {
  checkGlobalPublicRequestGate,
  checkPublicOrderIntakeAvailability,
  checkPublicOrderSubmissionGate,
  createPublicOrderWithSchedule,
  getLastDiningTableOrder,
  getOrderQuote,
  getOrderSessionMode,
  getTrackedOrderContext,
  getTrackedPublicOrder,
  issueIdempotentOrderSession,
  persistPickupCodeDisplay,
  preflightPublicOrder,
  recordPublicOrderAttempt,
  revokeOrderSession,
  type StoredPublicOrder,
} from "@/server/public-order/trusted-rpc-repository";

type Timing = ReturnType<typeof createPerformanceTiming>;

export class PublicOrderCircuitError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly responseBody?: Record<string, unknown>,
  ) {
    super(code);
  }
}

function requireSecret(name: "ABUSE_HASH_SECRET" | "TOKEN_DERIVATION_SECRET" | "TURNSTILE_SECRET_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PUBLIC_ORDER_CIRCUIT_B_${name}_MISSING`);
  return value;
}

function gateError(gate: { ok: boolean; code?: string } | null) {
  if (gate?.ok) return;
  const code = gate?.code ?? "RATE_LIMITED";
  throw new PublicOrderCircuitError(code, statusForCode(code));
}

function intakeError(gate: { ok: boolean; code?: string } | null) {
  if (gate?.ok) return;
  const code = gate?.code ?? "QR_ORDERING_UNAVAILABLE";
  throw new PublicOrderCircuitError(code, statusForCode(code));
}

async function assertCircuitBEnabled(deviceId: string, timing: Timing) {
  const flags = await timing.measureDb(() => resolveResilienceFeatureFlags(
    ["DUAL_ORDER_INTAKE_ENABLED"],
    { deviceId, rolloutKey: deviceId },
  ));
  if (!flags.DUAL_ORDER_INTAKE_ENABLED.enabled) {
    throw new PublicOrderCircuitError("CIRCUIT_B_UNAVAILABLE", 503);
  }
}

async function publicHashes(input: {
  scope: "SESSION" | "ORDER" | "TRACKING";
  clientIp: string;
  deviceId: string;
  qrToken?: string;
  behavior: string;
}) {
  const abuseSecret = requireSecret("ABUSE_HASH_SECRET");
  const [ipHash, deviceHash, qrTokenHash, behaviorHash] = await Promise.all([
    hmacHex(abuseSecret, `ip:${input.clientIp}`),
    hmacHex(abuseSecret, `device:${input.deviceId}`),
    input.qrToken ? hmacHex(abuseSecret, `qr:${input.qrToken}`) : Promise.resolve(""),
    hmacHex(abuseSecret, input.behavior),
  ]);
  return { ipHash, deviceHash, qrTokenHash, behaviorHash };
}

async function persistPickupCode(
  order: StoredPublicOrder,
  pickupCode: string,
  timing: Timing,
) {
  if (!publicOrderNeedsPickupCode(order)) return;
  await timing.measureDb(() => persistPickupCodeDisplay(order.order_id, pickupCode));
}

export async function issueOrderSessionThroughCircuitB(
  input: IssueOrderSessionInput,
  context: {
    clientIp: string;
    requestId: string;
    timing: Timing;
  },
) {
  await assertCircuitBEnabled(input.deviceId, context.timing);
  const orderingMode = input.orderingMode;
  const hashes = await publicHashes({
    scope: "SESSION",
    clientIp: context.clientIp,
    deviceId: input.deviceId,
    qrToken: input.qrToken,
    behavior: publicOrderSessionAbuseBehavior({
      orderingMode,
      clientIp: context.clientIp,
      deviceId: input.deviceId,
      qrToken: input.qrToken,
    }),
  });
  const intake = await context.timing.measureDb(
    () => checkPublicOrderIntakeAvailability(input.qrToken, input.deviceId),
  );
  if (intake?.code === "QR_ORDERING_UNAVAILABLE") intakeError(intake);

  const globalGate = await context.timing.measureDb(() => checkGlobalPublicRequestGate({
    scope: "SESSION",
    ipHash: hashes.ipHash,
    deviceHash: hashes.deviceHash,
    behaviorHash: hashes.behaviorHash,
    requestId: context.requestId,
  }));
  gateError(globalGate);

  const preflight = await context.timing.measureDb(() => preflightPublicOrder({
    scope: "SESSION",
    orderingMode,
    qrToken: input.qrToken,
    deviceHash: hashes.deviceHash,
    ipHash: hashes.ipHash,
    qrTokenHash: hashes.qrTokenHash,
    behaviorHash: hashes.behaviorHash,
    requestId: context.requestId,
    intakeCode: intake?.code ?? null,
  }));
  const resumableOrder = preflight?.resumable_order;
  if (resumableOrder) {
    const { trackingToken } = await derivePublicOrderTokens(
      resumableOrder.order_id,
      requireSecret("TOKEN_DERIVATION_SECRET"),
    );
    return {
      status: 200,
      body: buildPublicOrderResumeResponse(
        orderingMode,
        trackingToken,
        resumableOrder.order_status,
      ),
    };
  }
  if (!preflight?.ok) {
    const code = preflight?.code ?? "QR_ORDERING_UNAVAILABLE";
    throw new PublicOrderCircuitError(code, statusForCode(code));
  }

  const sessionToken = await deriveOrderSessionToken(
    input.sessionRequestId ?? randomUUID(),
    input.qrToken,
    input.deviceId,
    requireSecret("TOKEN_DERIVATION_SECRET"),
  );
  const sessionTokenHash = await sha256Hex(sessionToken);
  const result = await context.timing.measure(
    "sessionMs",
    () => context.timing.measureDb(() => issueIdempotentOrderSession({
      qrToken: input.qrToken,
      sessionTokenHash,
      ipHash: hashes.ipHash,
      deviceHash: hashes.deviceHash,
      qrTokenHash: hashes.qrTokenHash,
      behaviorHash: hashes.behaviorHash,
      requestId: context.requestId,
      orderingMode,
    })),
  );
  if (!result?.ok || !result.stall_id || !result.order_session_id || !result.expires_at) {
    const code = result?.code ?? "ORDER_CREATE_ERROR";
    throw new PublicOrderCircuitError(code, statusForCode(code));
  }

  const sessionResponse = buildPublicOrderSessionResponse({
    orderSessionToken: sessionToken,
    expiresAt: canonicalPublicOrderTimestamp(result.expires_at),
    orderingMode,
    capacity: result.capacity,
  });

  if (!input.includeMenu) {
    return {
      status: result.idempotent_replay ? 200 : 201,
      body: sessionResponse,
    };
  }

  const menu = await context.timing.measureDb(
    () => getCachedPublicMenuForQrToken(input.qrToken, orderingMode),
  );
  if (!menu) {
    await context.timing.measureDb(() => revokeOrderSession(result.order_session_id!));
    throw new PublicOrderCircuitError("QR_NOT_ACTIVE", 409);
  }
  return {
    status: result.idempotent_replay ? 200 : 201,
    body: {
      ...menu,
      lotteryEnabled: orderingMode === "DEFAULT" && menu.lotteryEnabled,
      ...sessionResponse,
    },
  };
}

async function recordSubmissionFailure(
  code: string,
  values: {
    requestId: string;
    ipHash: string;
    deviceHash: string;
    qrTokenHash: string;
    sessionHash: string;
    behaviorHash: string;
    idempotencyHash: string;
  },
  timing: Timing,
) {
  const session = await timing.measureDb(() => getOrderSessionMode(values.sessionHash));
  await timing.measureDb(() => recordPublicOrderAttempt({
    requestId: values.requestId,
    eventType: "ORDER_SUBMIT",
    reasonCode: code,
    organizationId: session?.organizationId,
    stallId: session?.stallId,
    qrCodeId: session?.qrCodeId,
    orderSessionId: session?.id,
    ipHash: values.ipHash,
    deviceHash: values.deviceHash,
    qrTokenHash: values.qrTokenHash,
    orderSessionHash: values.sessionHash,
    behaviorHash: values.behaviorHash,
    idempotencyHash: values.idempotencyHash,
  }));
}

export async function createOrderThroughCircuitB(
  input: PublicOrderInput,
  context: {
    clientIp: string;
    requestId: string;
    timing: Timing;
  },
) {
  await assertCircuitBEnabled(input.deviceId, context.timing);
  const sortedBehavior = canonicalPublicOrderBehavior(input.items);
  const hashes = await publicHashes({
    scope: "ORDER",
    clientIp: context.clientIp,
    deviceId: input.deviceId,
    qrToken: input.qrToken,
    behavior: publicOrderSubmissionAbuseBehavior({
      orderingMode: input.orderingMode,
      deviceId: input.deviceId,
      qrToken: input.qrToken,
      scheduledPickupAt: input.scheduledPickupAt,
      lotteryDrawId: input.lotteryDrawId,
      canonicalItems: sortedBehavior,
    }),
  });
  const [sessionHash, idempotencyHash] = await Promise.all([
    sha256Hex(input.orderSessionToken),
    hmacHex(requireSecret("ABUSE_HASH_SECRET"), `idempotency:${input.idempotencyKey}`),
  ]);
  const failureValues = {
    requestId: context.requestId,
    ipHash: hashes.ipHash,
    deviceHash: hashes.deviceHash,
    qrTokenHash: hashes.qrTokenHash,
    sessionHash,
    behaviorHash: hashes.behaviorHash,
    idempotencyHash,
  };

  const intake = await context.timing.measureDb(
    () => checkPublicOrderIntakeAvailability(input.qrToken, input.deviceId),
  );
  if (intake?.code === "QR_ORDERING_UNAVAILABLE") intakeError(intake);

  const globalGate = await context.timing.measureDb(() => checkGlobalPublicRequestGate({
    scope: "ORDER",
    ipHash: hashes.ipHash,
    deviceHash: hashes.deviceHash,
    behaviorHash: hashes.behaviorHash,
    requestId: context.requestId,
  }));
  gateError(globalGate);

  const preflight = await context.timing.measureDb(() => preflightPublicOrder({
    scope: "ORDER",
    orderingMode: input.orderingMode,
    qrToken: input.qrToken,
    deviceHash: hashes.deviceHash,
    ipHash: hashes.ipHash,
    qrTokenHash: hashes.qrTokenHash,
    behaviorHash: hashes.behaviorHash,
    requestId: context.requestId,
    sessionTokenHash: sessionHash,
    idempotencyKey: input.idempotencyKey,
    idempotencyHash,
    requestedFulfillmentAt: input.scheduledPickupAt,
    lotteryDrawId: input.lotteryDrawId,
    items: publicOrderItemsToRpc(input.items),
    waitAcknowledged: input.waitAcknowledged,
    intakeCode: intake?.code ?? null,
  }));
  if (!preflight?.ok) {
    const code = preflight?.code ?? "ORDER_CREATE_ERROR";
    throw new PublicOrderCircuitError(
      code,
      statusForCode(code),
      buildPublicOrderCapacityDetails(preflight?.capacity),
    );
  }

  const existing = preflight.idempotent_order;
  if (existing) {
    const tokens = await derivePublicOrderTokens(
      existing.order_id,
      requireSecret("TOKEN_DERIVATION_SECRET"),
      publicOrderReplayPickupCodeLength(existing.pickup_code_length),
    );
    await persistPickupCode(existing, tokens.pickupCode, context.timing);
    return {
      status: 200,
      body: buildPublicOrderResponse(
        existing,
        tokens.trackingToken,
        tokens.pickupCode,
        canonicalPublicOrderTimestamp(existing.created_at),
      ),
    };
  }
  const submissionGate = await context.timing.measureDb(() => checkPublicOrderSubmissionGate({
    sessionTokenHash: sessionHash,
    ipHash: hashes.ipHash,
    deviceHash: hashes.deviceHash,
    qrTokenHash: hashes.qrTokenHash,
    behaviorHash: hashes.behaviorHash,
    requestId: context.requestId,
  }));
  gateError(submissionGate);

  const turnstile = await context.timing.measure("turnstileMs", () => verifyTurnstile({
    token: input.turnstileToken,
    remoteIp: context.clientIp,
    idempotencyKey: input.turnstileIdempotencyKey ?? randomUUID(),
    secret: requireSecret("TURNSTILE_SECRET_KEY"),
    expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim() || undefined,
    expectedAction: "public_order",
    allowTestKeys: process.env.TURNSTILE_ALLOW_TEST_KEYS === "true",
    environment: process.env.APP_ENV?.trim() || "development",
  }));
  if (!turnstile.ok) {
    await recordSubmissionFailure(turnstile.code, failureValues, context.timing);
    throw new PublicOrderCircuitError(turnstile.code, turnstile.code === "TURNSTILE_UNAVAILABLE" ? 503 : 400);
  }

  const orderId = input.clientOrderId ?? randomUUID();
  const provisionalTokens = await derivePublicOrderTokens(
    orderId,
    requireSecret("TOKEN_DERIVATION_SECRET"),
  );
  const [trackingTokenHash, pickupCodeHash] = await Promise.all([
    sha256Hex(provisionalTokens.trackingToken),
    sha256Hex(provisionalTokens.pickupCode),
  ]);
  const result = await context.timing.measureDb(() => createPublicOrderWithSchedule({
    orderingMode: input.orderingMode,
    orderId,
    qrToken: input.qrToken,
    sessionTokenHash: sessionHash,
    deviceHash: hashes.deviceHash,
    ipHash: hashes.ipHash,
    qrTokenHash: hashes.qrTokenHash,
    behaviorHash: hashes.behaviorHash,
    idempotencyKey: input.idempotencyKey,
    idempotencyHash,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    deliveryAddress: input.deliveryAddress,
    customerNote: input.customerNote,
    items: publicOrderItemsToRpc(input.items),
    trackingTokenHash,
    pickupCodeHash,
    requestId: context.requestId,
    waitAcknowledged: input.waitAcknowledged,
    scheduledPickupAt: input.scheduledPickupAt,
    lotteryDrawId: input.lotteryDrawId,
  }));
  if (!result?.ok || !result.order) {
    const code = result?.code ?? "ORDER_CREATE_ERROR";
    throw new PublicOrderCircuitError(
      code,
      statusForCode(code),
      buildPublicOrderCapacityDetails(result?.capacity),
    );
  }

  const finalTokens = result.order.order_id === orderId
    ? provisionalTokens
    : await derivePublicOrderTokens(
      result.order.order_id,
      requireSecret("TOKEN_DERIVATION_SECRET"),
    );
  const quote = await context.timing.measureDb(() => getOrderQuote(result.order!.order_id));
  result.order.fulfillment_type = quote?.fulfillmentType ?? result.order.fulfillment_type;
  result.order.pickup_required = quote?.fulfillmentType === "TAKEOUT";
  result.order.quoted_wait_minutes = quote?.quotedWaitMinutes ?? null;
  result.order.quoted_ready_at = quote?.quotedReadyAt?.toISOString() ?? null;
  result.order.scheduled_pickup_at = quote?.scheduledPickupAt?.toISOString() ?? null;
  result.order.requested_fulfillment_at = quote?.requestedFulfillmentAt?.toISOString() ?? null;
  result.order.discount_amount = quote?.discountAmount ?? 0;
  await persistPickupCode(result.order, finalTokens.pickupCode, context.timing);
  return {
    status: result.idempotent_replay ? 200 : 201,
    body: buildPublicOrderResponse(
      result.order,
      finalTokens.trackingToken,
      finalTokens.pickupCode,
      canonicalPublicOrderTimestamp(result.order.created_at),
    ),
  };
}

export async function getOrderThroughCircuitB(
  input: GetPublicOrderInput,
  context: {
    clientIp: string;
    requestId: string;
    timing: Timing;
  },
) {
  await assertCircuitBEnabled(input.deviceId, context.timing);
  const trackingHash = await sha256Hex(input.trackingToken);
  const hashes = await publicHashes({
    scope: "TRACKING",
    clientIp: context.clientIp,
    deviceId: input.deviceId,
    behavior: `tracking:${trackingHash}`,
  });
  const globalGate = await context.timing.measureDb(() => checkGlobalPublicRequestGate({
    scope: "TRACKING",
    ipHash: hashes.ipHash,
    deviceHash: hashes.deviceHash,
    behaviorHash: hashes.behaviorHash,
    requestId: context.requestId,
  }));
  gateError(globalGate);

  const stored = await context.timing.measureDb(
    () => getTrackedPublicOrder(trackingHash, hashes.deviceHash),
  );
  if (!stored) {
    await context.timing.measureDb(() => recordPublicOrderAttempt({
      requestId: context.requestId,
      eventType: "TRACKING_READ",
      reasonCode: "ORDER_NOT_FOUND",
      ipHash: hashes.ipHash,
      deviceHash: hashes.deviceHash,
      orderSessionHash: trackingHash,
    }));
    throw new PublicOrderCircuitError("ORDER_NOT_FOUND", 404);
  }

  const pickupCode = stored.fulfillmentType === "TAKEOUT"
    ? (await derivePublicOrderTokens(
      stored.orderId,
      requireSecret("TOKEN_DERIVATION_SECRET"),
      stored.pickupCodeLength === 6 ? 6 : 3,
    )).pickupCode
    : null;
  const orderContext = await context.timing.measureDb(() => getTrackedOrderContext(stored.orderId));
  if (!orderContext?.stall.orderingSettings) {
    throw new PublicOrderCircuitError("ORDER_CREATE_ERROR", 500);
  }
  const lastTableOrder = orderContext.diningTableId
    ? await context.timing.measureDb(
      () => getLastDiningTableOrder(orderContext.stallId, orderContext.diningTableId!),
    )
    : null;
  const fulfillmentTime = resolveFulfillmentTimeReadModel({
    source: orderContext.source,
    fulfillmentType: String(stored.fulfillmentType ?? ""),
    scheduledPickupAt: typeof stored.scheduledPickupAt === "string"
      ? stored.scheduledPickupAt
      : null,
    requestedFulfillmentAt: typeof stored.requestedFulfillmentAt === "string"
      ? stored.requestedFulfillmentAt
      : null,
    committedFulfillmentAt: typeof stored.committedFulfillmentAt === "string"
      ? stored.committedFulfillmentAt
      : null,
    pendingFulfillmentAt: typeof stored.pendingFulfillmentAt === "string"
      ? stored.pendingFulfillmentAt
      : null,
    fulfillmentTimeState: (stored.fulfillmentTimeState ?? "NOT_REQUESTED") as FulfillmentTimeState,
    fulfillmentTimeVersion: typeof stored.fulfillmentTimeVersion === "number"
      ? stored.fulfillmentTimeVersion
      : 0,
  });
  const publicOrder: Record<string, unknown> = { ...stored, ...fulfillmentTime };
  delete publicOrder.orderId;
  delete publicOrder.pickupCodeLength;

  return {
    status: 200,
    body: {
      order: {
        ...publicOrder,
        pickupVerificationCode: pickupCode,
        publicMenuIdentifier: orderContext.stall.code.toLowerCase(),
        estimatedWaitMinutes:
          orderContext.quotedWaitMinutes
          ?? orderContext.stall.orderingSettings.estimatedWaitMinutes,
        quotedWaitMinutes: orderContext.quotedWaitMinutes,
        quotedReadyAt: orderContext.quotedReadyAt?.toISOString() ?? null,
        lastTableOrderAt: lastTableOrder?.createdAt.toISOString() ?? null,
      },
    },
  };
}
