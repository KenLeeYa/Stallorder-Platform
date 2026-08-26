import "server-only";

import { randomUUID } from "node:crypto";
import type { createPerformanceTiming } from "@/lib/performance-timing";
import { getCachedPublicMenuForQrToken } from "@/lib/public-menu";
import {
  cancelTrackedPublicOrder,
  editTrackedPublicOrder,
  PublicOrderEditError,
} from "@/lib/public-order-edit";
import type {
  CancelTrackedPublicOrderInput,
  UpdateTrackedPublicOrderInput,
} from "@/lib/public-order-edit-contract";
import { StaffOrderCreateError } from "@/lib/staff-order-create";
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
  publicOrderCustomerDetailsCode,
  resolvePublicOrderFulfillmentType,
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
  resolveStoredPickupCode,
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
  getReorderPreparationContext,
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
  if (process.env.NODE_ENV === "development") {
    return;
  }
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
    const quote = await context.timing.measureDb(() => getOrderQuote(existing.order_id));
    existing.pickup_code_display = quote?.pickupCodeDisplay ?? null;
    const pickupCode = resolveStoredPickupCode(existing, tokens.pickupCode);
    await persistPickupCode(existing, pickupCode, context.timing);
    return {
      status: 200,
      body: buildPublicOrderResponse(
        existing,
        tokens.trackingToken,
        pickupCode,
        canonicalPublicOrderTimestamp(existing.created_at),
      ),
    };
  }
  const customerDetailsCode = publicOrderCustomerDetailsCode(
    input,
    resolvePublicOrderFulfillmentType(input.orderingMode, preflight.qr_context),
  );
  if (customerDetailsCode) {
    throw new PublicOrderCircuitError(
      customerDetailsCode,
      statusForCode(customerDetailsCode),
    );
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
  })).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("PICKUP_CODE_CAPACITY_EXCEEDED")) {
      throw new PublicOrderCircuitError(
        "PICKUP_CODE_CAPACITY_EXCEEDED",
        statusForCode("PICKUP_CODE_CAPACITY_EXCEEDED"),
      );
    }
    throw error;
  });
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
  result.order.pickup_code_display = quote?.pickupCodeDisplay
    ?? result.order.pickup_code_display
    ?? null;
  const pickupCode = resolveStoredPickupCode(result.order, finalTokens.pickupCode);
  await persistPickupCode(result.order, pickupCode, context.timing);
  return {
    status: result.idempotent_replay ? 200 : 201,
    body: buildPublicOrderResponse(
      result.order,
      finalTokens.trackingToken,
      pickupCode,
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

  const fallbackPickupCode = stored.fulfillmentType === "TAKEOUT"
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
  const pickupCode = fallbackPickupCode === null
    ? null
    : resolveStoredPickupCode(
      { pickup_code_display: orderContext.pickupCodeDisplay },
      fallbackPickupCode,
    );
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
        paymentProviders: (orderContext.stall.paymentProviderConnections ?? []).map((connection) => ({
          provider: connection.provider,
          environment: connection.environment,
          capabilities: connection.capabilities,
        })),
      },
    },
  };
}

type TrackedMutationContext = {
  clientIp: string;
  requestId: string;
  timing: Timing;
};

async function resolveTrackedMutationOrder(
  input: { trackingToken: string; deviceId: string },
  context: TrackedMutationContext,
  behavior: string,
) {
  const trackingHash = await sha256Hex(input.trackingToken);
  const hashes = await publicHashes({
    scope: "TRACKING",
    clientIp: context.clientIp,
    deviceId: input.deviceId,
    behavior: `${behavior}:${trackingHash}`,
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
  if (!stored?.orderId) throw new PublicOrderCircuitError("ORDER_NOT_FOUND", 404);
  return stored.orderId;
}

export async function prepareReorderThroughCircuitB(
  input: { trackingToken: string; deviceId: string },
  context: TrackedMutationContext,
) {
  await assertCircuitBEnabled(input.deviceId, context.timing);
  const orderId = await resolveTrackedMutationOrder(input, context, "prepare-reorder");
  const order = await context.timing.measureDb(() => getReorderPreparationContext(orderId));
  if (!order) throw new PublicOrderCircuitError("ORDER_NOT_FOUND", 404);
  if (order.source !== "QR_MENU" && order.source !== "LINE_DELIVERY") {
    throw new PublicOrderCircuitError("NOT_EDITABLE_SOURCE", 403);
  }
  if (order.paymentStatus !== "UNPAID" || order.payment) {
    throw new PublicOrderCircuitError("PAYMENT_ALREADY_RECORDED", 409);
  }
  if (order.discountAmount !== 0 || order.discountOptionId) {
    throw new PublicOrderCircuitError("DISCOUNT_ALREADY_APPLIED", 409);
  }
  if (order.status !== "WAITING_CONFIRMATION" && order.status !== "CONFIRMED") {
    throw new PublicOrderCircuitError("ORDER_ALREADY_STARTED", 409);
  }
  if (order.productionTasks.some((task) => task.status !== "PENDING")) {
    throw new PublicOrderCircuitError("ORDER_ALREADY_STARTED", 409);
  }
  if (order.printJobs.some((job) => job.status !== "PENDING")) {
    throw new PublicOrderCircuitError("PRINT_ALREADY_STARTED", 409);
  }
  if (order.items.some((item) => item.status !== "PENDING")) {
    throw new PublicOrderCircuitError("ORDER_ALREADY_STARTED", 409);
  }

  const matchingQrCodes = order.stall.qrCodes.filter((qrCode) => order.fulfillmentType === "DINE_IN"
    ? qrCode.diningTableId === order.diningTableId
    : qrCode.diningTableId === null && (
      qrCode.fulfillmentTypeContext === null
      || qrCode.fulfillmentTypeContext === order.fulfillmentType
    ));
  const qrCode = matchingQrCodes.find((candidate) => (
    !candidate.stallScheduleId
    && !candidate.locationId
    && !candidate.marketEventId
  )) ?? matchingQrCodes[0];
  if (!qrCode) throw new PublicOrderCircuitError("QR_NOT_ACTIVE", 409);

  const products = new Map(order.products.map((product) => [product.id, product]));
  const stallProducts = new Map(order.stallProducts.map((assignment) => [assignment.productId, assignment]));
  const now = Date.now();
  const availableItems: Array<Record<string, unknown>> = [];
  const unavailableItems: Array<{ name: string; reason: string }> = [];

  for (const item of order.items) {
    const product = item.productId ? products.get(item.productId) : null;
    const assignment = item.productId ? stallProducts.get(item.productId) : null;
    const isWithinWindow = assignment
      && (!assignment.availableFrom || assignment.availableFrom.getTime() <= now)
      && (!assignment.availableUntil || assignment.availableUntil.getTime() > now);
    if (!item.productId || !product?.isActive || !assignment?.isEnabled || assignment.isSoldOut || !isWithinWindow) {
      unavailableItems.push({
        name: item.name,
        reason: assignment?.isSoldOut ? "目前售罄" : "目前無法供應",
      });
      continue;
    }

    const options = new Map(product.noteGroupAssignments.flatMap((group) => (
      group.noteGroup.options.map((option) => [option.id, {
        ...option,
        noteGroupId: group.noteGroupId,
      }] as const)
    )));
    const historicalOptionIds = item.noteOptions.flatMap((note) => note.noteOptionId ? [note.noteOptionId] : []);
    const validOptions = historicalOptionIds.flatMap((id) => {
      const option = options.get(id);
      return option ? [option] : [];
    });
    const selectedByGroup = new Map<string, number>();
    for (const option of validOptions) {
      selectedByGroup.set(
        option.noteGroupId,
        (selectedByGroup.get(option.noteGroupId) ?? 0) + 1,
      );
    }
    const requiredSelectionMissing = product.noteGroupAssignments.some((group) => {
      const minimum = Math.max(
        group.noteGroup.minSelections,
        group.noteGroup.isRequired ? 1 : 0,
      );
      return (selectedByGroup.get(group.noteGroupId) ?? 0) < minimum;
    });
    const currentUnitPrice = Math.max(
      0,
      (assignment.priceOverride ?? product.defaultPrice)
        + validOptions.reduce((total, option) => total + option.priceDelta, 0),
    );
    availableItems.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      note: item.note ?? "",
      noteOptionIds: validOptions.map((option) => option.id),
      bundleChoiceIds: [],
      previousUnitPrice: item.unitPrice,
      currentUnitPrice,
      priceChanged: currentUnitPrice !== item.unitPrice,
      needsReview: product.kind === "BUNDLE"
        || validOptions.length !== historicalOptionIds.length
        || requiredSelectionMissing,
    });
  }

  const orderingMode = order.fulfillmentType === "DELIVERY" ? "DELIVERY" : "PREORDER";
  const view = orderingMode === "DELIVERY" ? "delivery" : "pickup";
  return {
    status: 200,
    body: {
      qrToken: qrCode.token,
      orderingMode,
      orderPath: `/store/${encodeURIComponent(order.stall.code)}?view=${view}`,
      customerName: order.customerName,
      customerPhone: order.customerPhone ?? "",
      deliveryAddress: order.deliveryAddress ?? "",
      customerNote: order.note ?? "",
      scheduledPickupAt: (
        order.requestedFulfillmentAt
        ?? order.scheduledPickupAt
      )?.toISOString() ?? "",
      availableItems,
      unavailableItems,
    },
  };
}

export async function editOrderThroughCircuitB(
  input: UpdateTrackedPublicOrderInput & { trackingToken: string },
  context: TrackedMutationContext,
) {
  const orderId = await resolveTrackedMutationOrder(input, context, "tracking-edit");
  const turnstile = await context.timing.measure("turnstileMs", () => verifyTurnstile({
    token: input.turnstileToken,
    remoteIp: context.clientIp,
    idempotencyKey: input.idempotencyKey,
    secret: requireSecret("TURNSTILE_SECRET_KEY"),
    expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim() || undefined,
    expectedAction: "public_order",
    allowTestKeys: process.env.TURNSTILE_ALLOW_TEST_KEYS === "true",
    environment: process.env.APP_ENV?.trim() || process.env.NODE_ENV || "development",
  }));
  if (!turnstile.ok) {
    throw new PublicOrderCircuitError(turnstile.code, statusForCode(turnstile.code));
  }

  try {
    const result = await context.timing.measureDb(() => editTrackedPublicOrder({
      orderId,
      request: input,
    }));
    return {
      status: 200,
      body: { trackingToken: input.trackingToken, ...result },
    };
  } catch (error) {
    throw publicOrderMutationError(error);
  }
}

export async function cancelOrderThroughCircuitB(
  input: CancelTrackedPublicOrderInput & { trackingToken: string },
  context: TrackedMutationContext,
) {
  const orderId = await resolveTrackedMutationOrder(input, context, "tracking-cancel");
  try {
    const result = await context.timing.measureDb(() => cancelTrackedPublicOrder(orderId));
    return { status: 200, body: result };
  } catch (error) {
    throw publicOrderMutationError(error);
  }
}

function publicOrderMutationError(error: unknown) {
  if (error instanceof PublicOrderCircuitError) return error;
  if (error instanceof PublicOrderEditError) {
    const status = error.code === "NOT_EDITABLE_SOURCE"
      ? 403
      : error.code === "ORDER_NOT_FOUND"
        ? 404
        : error.code === "INVALID_CUSTOMER_DETAILS" || error.code === "INVALID_DELIVERY_DETAILS"
          ? statusForCode(error.code)
          : 409;
    return new PublicOrderCircuitError(error.code, status);
  }
  if (error instanceof StaffOrderCreateError) {
    const code = error.code === "ORDER_LIMIT_EXCEEDED" ? "EXCESSIVE_TOTAL_QUANTITY" : error.code;
    return new PublicOrderCircuitError(code, statusForCode(code));
  }
  return error;
}
