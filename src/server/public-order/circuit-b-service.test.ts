import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { createPublicOrderSchema } from "../../../supabase/functions/_shared/schemas";

const mocks = vi.hoisted(() => ({
  resolveResilienceFeatureFlags: vi.fn(),
  verifyTurnstile: vi.fn(),
  getCachedPublicMenuForQrToken: vi.fn(),
  checkGlobalPublicRequestGate: vi.fn(),
  checkPublicOrderIntakeAvailability: vi.fn(),
  checkPublicOrderSubmissionGate: vi.fn(),
  createPublicOrderWithSchedule: vi.fn(),
  getLastDiningTableOrder: vi.fn(),
  getOrderQuote: vi.fn(),
  getOrderSessionMode: vi.fn(),
  getPublicSessionMenuContext: vi.fn(),
  getTrackedOrderContext: vi.fn(),
  getTrackedPublicOrder: vi.fn(),
  issueIdempotentOrderSession: vi.fn(),
  lookupPublicOrderIdempotency: vi.fn(),
  lookupResumablePublicOrder: vi.fn(),
  persistPickupCodeDisplay: vi.fn(),
  preflightPublicOrder: vi.fn(),
  recordPublicOrderAttempt: vi.fn(),
  revokeOrderSession: vi.fn(),
}));

vi.mock("@/server/resilience/feature-flag-service", () => ({
  resolveResilienceFeatureFlags: mocks.resolveResilienceFeatureFlags,
}));

vi.mock("../../../supabase/functions/_shared/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile,
}));

vi.mock("@/lib/public-menu", () => ({
  getCachedPublicMenuForQrToken: mocks.getCachedPublicMenuForQrToken,
}));

vi.mock("@/server/public-order/trusted-rpc-repository", () => ({
  checkGlobalPublicRequestGate: mocks.checkGlobalPublicRequestGate,
  checkPublicOrderIntakeAvailability: mocks.checkPublicOrderIntakeAvailability,
  checkPublicOrderSubmissionGate: mocks.checkPublicOrderSubmissionGate,
  createPublicOrderWithSchedule: mocks.createPublicOrderWithSchedule,
  getLastDiningTableOrder: mocks.getLastDiningTableOrder,
  getOrderQuote: mocks.getOrderQuote,
  getOrderSessionMode: mocks.getOrderSessionMode,
  getPublicSessionMenuContext: mocks.getPublicSessionMenuContext,
  getTrackedOrderContext: mocks.getTrackedOrderContext,
  getTrackedPublicOrder: mocks.getTrackedPublicOrder,
  issueIdempotentOrderSession: mocks.issueIdempotentOrderSession,
  lookupPublicOrderIdempotency: mocks.lookupPublicOrderIdempotency,
  lookupResumablePublicOrder: mocks.lookupResumablePublicOrder,
  persistPickupCodeDisplay: mocks.persistPickupCodeDisplay,
  preflightPublicOrder: mocks.preflightPublicOrder,
  recordPublicOrderAttempt: mocks.recordPublicOrderAttempt,
  revokeOrderSession: mocks.revokeOrderSession,
}));

function timing() {
  return createPerformanceTiming({
    route: "/api/public/orders",
    requestId: "request-test",
    logger: () => undefined,
  });
}

function validOrder() {
  return createPublicOrderSchema.parse({
    qrToken: "demo-aming-chicken-qr-2026-rotate-me",
    orderSessionToken: `stos_${"a".repeat(43)}`,
    deviceId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    clientOrderId: "33333333-3333-4333-8333-333333333333",
    turnstileIdempotencyKey: "44444444-4444-4444-8444-444444444444",
    items: [{
      productId: "55555555-5555-4555-8555-555555555555",
      quantity: 1,
      noteOptionIds: [],
    }],
    turnstileToken: "turnstile-test-token",
  });
}

describe("Circuit B public order service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ABUSE_HASH_SECRET", "abuse-test-secret");
    vi.stubEnv("TOKEN_DERIVATION_SECRET", "token-test-secret");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-test-secret");
    mocks.resolveResilienceFeatureFlags.mockResolvedValue({
      DUAL_ORDER_INTAKE_ENABLED: { enabled: true },
    });
    mocks.checkGlobalPublicRequestGate.mockResolvedValue({ ok: true });
    mocks.checkPublicOrderIntakeAvailability.mockResolvedValue({ ok: true });
    mocks.lookupResumablePublicOrder.mockResolvedValue(null);
    mocks.preflightPublicOrder.mockImplementation(async (input: { intakeCode?: string | null }) => ({
      ok: !input.intakeCode,
      code: input.intakeCode ?? undefined,
      resumable_order: null,
      idempotent_order: null,
      qr_context: {
        dining_table_id: null,
        fulfillment_type_context: "TAKEOUT",
        table: null,
        settings: {
          dine_in_enabled: true,
          delivery_module_enabled: true,
        },
      },
    }));
    mocks.getOrderSessionMode.mockResolvedValue({
      id: "66666666-6666-4666-8666-666666666666",
      organizationId: "77777777-7777-4777-8777-777777777777",
      stallId: "88888888-8888-4888-8888-888888888888",
      qrCodeId: "99999999-9999-4999-8999-999999999999",
      orderingMode: "DEFAULT",
    });
    mocks.lookupPublicOrderIdempotency.mockResolvedValue(null);
    mocks.checkPublicOrderSubmissionGate.mockResolvedValue({ ok: true });
    mocks.recordPublicOrderAttempt.mockResolvedValue([]);
  });

  it("rejects Circuit B before public-order work when the audited flag is disabled", async () => {
    mocks.resolveResilienceFeatureFlags.mockResolvedValue({
      DUAL_ORDER_INTAKE_ENABLED: { enabled: false },
    });
    const { issueOrderSessionThroughCircuitB } = await import(
      "./circuit-b-service"
    );

    await expect(issueOrderSessionThroughCircuitB({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DEFAULT",
      includeMenu: true,
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    })).rejects.toMatchObject({
      code: "CIRCUIT_B_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.checkGlobalPublicRequestGate).not.toHaveBeenCalled();
  });

  it("blocks a new session during emergency degraded mode after checking for a resumable order", async () => {
    mocks.checkPublicOrderIntakeAvailability.mockResolvedValue({
      ok: false,
      code: "QR_ORDERING_DEGRADED",
    });
    const { issueOrderSessionThroughCircuitB } = await import("./circuit-b-service");

    await expect(issueOrderSessionThroughCircuitB({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DEFAULT",
      includeMenu: false,
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    })).rejects.toMatchObject({
      code: "QR_ORDERING_DEGRADED",
      status: 503,
    });
    expect(mocks.preflightPublicOrder).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "SESSION", intakeCode: "QR_ORDERING_DEGRADED" }),
    );
    expect(mocks.issueIdempotentOrderSession).not.toHaveBeenCalled();
  });

  it("returns a resumable order during emergency degraded mode", async () => {
    mocks.checkPublicOrderIntakeAvailability.mockResolvedValue({
      ok: false,
      code: "QR_ORDERING_DEGRADED",
    });
    mocks.preflightPublicOrder.mockResolvedValue({
      ok: true,
      resumable_order: {
        order_id: "33333333-3333-4333-8333-333333333333",
        order_status: "WAITING_CONFIRMATION",
      },
    });
    const { issueOrderSessionThroughCircuitB } = await import("./circuit-b-service");

    const result = await issueOrderSessionThroughCircuitB({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DEFAULT",
      includeMenu: false,
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      orderingMode: "DEFAULT",
      resumeOrder: { orderStatus: "WAITING_CONFIRMATION" },
    });
    expect(mocks.issueIdempotentOrderSession).not.toHaveBeenCalled();
  });

  it("rejects a sealed backend before any rate-limit write", async () => {
    mocks.checkPublicOrderIntakeAvailability.mockResolvedValue({
      ok: false,
      code: "QR_ORDERING_UNAVAILABLE",
    });
    const { issueOrderSessionThroughCircuitB } = await import("./circuit-b-service");

    await expect(issueOrderSessionThroughCircuitB({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DEFAULT",
      includeMenu: false,
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    })).rejects.toMatchObject({
      code: "QR_ORDERING_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.checkGlobalPublicRequestGate).not.toHaveBeenCalled();
  });

  it("uses an explicitly requested preorder mode for resume, session issue, menu cache, and response", async () => {
    mocks.issueIdempotentOrderSession.mockResolvedValue({
      ok: true,
      stall_id: "88888888-8888-4888-8888-888888888888",
      order_session_id: "66666666-6666-4666-8666-666666666666",
      expires_at: "2026-08-02T12:00:00.000Z",
      capacity: {
        quote_min_minutes: 10,
        quote_max_minutes: 15,
        acknowledgment_threshold_minutes: 20,
        requires_acknowledgment: false,
      },
    });
    mocks.getPublicSessionMenuContext.mockResolvedValue({
      diningTable: null,
      stall: {
        orderingSettings: {
          dineInEnabled: true,
          deliveryModuleEnabled: true,
        },
      },
    });
    mocks.getCachedPublicMenuForQrToken.mockResolvedValue({
      orderingMode: "PREORDER",
      preorderSlots: ["2026-08-03T04:00:00.000Z"],
      lotteryEnabled: false,
    });
    const { issueOrderSessionThroughCircuitB } = await import("./circuit-b-service");

    const result = await issueOrderSessionThroughCircuitB({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "PREORDER",
      includeMenu: true,
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    });

    expect(mocks.preflightPublicOrder).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "SESSION", orderingMode: "PREORDER" }),
    );
    expect(mocks.issueIdempotentOrderSession).toHaveBeenCalledWith(
      expect.objectContaining({ orderingMode: "PREORDER" }),
    );
    expect(mocks.getCachedPublicMenuForQrToken).toHaveBeenCalledWith(
      "demo-aming-chicken-qr-2026-rotate-me",
      "PREORDER",
    );
    expect(result.body).toMatchObject({
      orderingMode: "PREORDER",
      preorderSlots: ["2026-08-03T04:00:00.000Z"],
      lotteryEnabled: false,
      estimatedWaitMinutes: 0,
      estimatedWaitMinMinutes: 0,
      estimatedWaitMaxMinutes: 0,
      waitAcknowledgmentThresholdMinutes: null,
      requiresWaitAcknowledgment: false,
    });
  });

  it("keeps a physical QR DEFAULT session immediate instead of promoting it to preorder", async () => {
    mocks.issueIdempotentOrderSession.mockResolvedValue({
      ok: true,
      stall_id: "88888888-8888-4888-8888-888888888888",
      order_session_id: "66666666-6666-4666-8666-666666666666",
      expires_at: "2026-08-02T12:00:00.000Z",
      capacity: {
        quote_min_minutes: 10,
        quote_max_minutes: 15,
        acknowledgment_threshold_minutes: 20,
        requires_acknowledgment: false,
      },
    });
    mocks.getPublicSessionMenuContext.mockResolvedValue({
      diningTable: null,
      stall: {
        orderingSettings: {
          dineInEnabled: true,
          deliveryModuleEnabled: true,
        },
      },
    });
    mocks.getCachedPublicMenuForQrToken.mockResolvedValue({
      orderingMode: "DEFAULT",
      preorderSlots: [],
      lotteryEnabled: false,
    });
    const { issueOrderSessionThroughCircuitB } = await import("./circuit-b-service");

    const result = await issueOrderSessionThroughCircuitB({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DEFAULT",
      includeMenu: true,
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    });

    expect(mocks.preflightPublicOrder).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "SESSION", orderingMode: "DEFAULT" }),
    );
    expect(mocks.issueIdempotentOrderSession).toHaveBeenCalledWith(
      expect.objectContaining({ orderingMode: "DEFAULT" }),
    );
    expect(mocks.getCachedPublicMenuForQrToken).toHaveBeenCalledWith(
      "demo-aming-chicken-qr-2026-rotate-me",
      "DEFAULT",
    );
    expect(result.body).toMatchObject({
      orderingMode: "DEFAULT",
      preorderSlots: [],
      estimatedWaitMinutes: 15,
      estimatedWaitMinMinutes: 10,
      estimatedWaitMaxMinutes: 15,
      waitAcknowledgmentThresholdMinutes: 20,
      requiresWaitAcknowledgment: false,
    });
  });

  it("keeps the lightweight session query budget and audit correlation", async () => {
    mocks.issueIdempotentOrderSession.mockResolvedValue({
      ok: true,
      stall_id: "88888888-8888-4888-8888-888888888888",
      order_session_id: "66666666-6666-4666-8666-666666666666",
      expires_at: "2026-08-13T12:00:00.000Z",
    });
    mocks.getPublicSessionMenuContext.mockResolvedValue({
      diningTable: null,
      stall: {
        orderingSettings: {
          dineInEnabled: true,
          deliveryModuleEnabled: true,
        },
      },
    });
    const logger = vi.fn();
    const requestTiming = createPerformanceTiming({
      route: "/api/public/order-session",
      requestId: "request-budget-test",
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      now: () => 0,
      logger,
    });
    const { issueOrderSessionThroughCircuitB } = await import("./circuit-b-service");

    const result = await issueOrderSessionThroughCircuitB({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DEFAULT",
      includeMenu: false,
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-budget-test",
      timing: requestTiming,
    });
    requestTiming.finish({ status: result.status });

    expect(result.status).toBe(201);
    expect(mocks.getCachedPublicMenuForQrToken).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith("info", "request_completed", expect.objectContaining({
      requestId: "request-budget-test",
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: 201,
      dbQueryCount: 5,
    }));
  });

  it("always disables lottery in a delivery session response", async () => {
    mocks.issueIdempotentOrderSession.mockResolvedValue({
      ok: true,
      stall_id: "88888888-8888-4888-8888-888888888888",
      order_session_id: "66666666-6666-4666-8666-666666666666",
      expires_at: "2026-08-02T12:00:00.000Z",
    });
    mocks.getPublicSessionMenuContext.mockResolvedValue({
      diningTable: null,
      stall: {
        orderingSettings: {
          dineInEnabled: true,
          deliveryModuleEnabled: true,
        },
      },
    });
    mocks.getCachedPublicMenuForQrToken.mockResolvedValue({
      orderingMode: "DELIVERY",
      preorderSlots: [],
      lotteryEnabled: true,
    });
    const { issueOrderSessionThroughCircuitB } = await import("./circuit-b-service");

    const result = await issueOrderSessionThroughCircuitB({
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DELIVERY",
      includeMenu: true,
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    });

    expect(result.body).toMatchObject({
      orderingMode: "DELIVERY",
      preorderSlots: [],
      lotteryEnabled: false,
    });
  });

  it("records invalid Turnstile and never reaches the trusted create-order RPC", async () => {
    mocks.verifyTurnstile.mockResolvedValue({
      ok: false,
      code: "INVALID_TURNSTILE",
      errors: ["invalid-input-response"],
    });
    const { createOrderThroughCircuitB } = await import("./circuit-b-service");

    await expect(createOrderThroughCircuitB(validOrder(), {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    })).rejects.toMatchObject({
      code: "INVALID_TURNSTILE",
      status: 400,
    });

    expect(mocks.recordPublicOrderAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ORDER_SUBMIT",
        reasonCode: "INVALID_TURNSTILE",
      }),
    );
    expect(mocks.createPublicOrderWithSchedule).not.toHaveBeenCalled();
  });

  it("canonicalizes UUID casing before Circuit B abuse hashing", async () => {
    mocks.verifyTurnstile.mockResolvedValue({
      ok: false,
      code: "INVALID_TURNSTILE",
      errors: ["invalid-input-response"],
    });
    const { createOrderThroughCircuitB } = await import("./circuit-b-service");
    const lower = {
      ...validOrder(),
      items: [{
        productId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
        quantity: 1,
        note: "",
        noteOptionIds: ["fedcbafe-dcba-4fed-8cba-fedcbafedcba"],
        bundleChoiceIds: ["abcdefab-1234-4abc-8def-abcdefabcdef"],
      }],
    };
    const upper = {
      ...lower,
      items: lower.items.map((item) => ({
        ...item,
        productId: item.productId.toUpperCase(),
        noteOptionIds: item.noteOptionIds.map((id) => id.toUpperCase()),
        bundleChoiceIds: item.bundleChoiceIds.map((id) => id.toUpperCase()),
      })),
    };
    const context = {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    };

    await expect(createOrderThroughCircuitB(lower, context)).rejects.toMatchObject({
      code: "INVALID_TURNSTILE",
    });
    await expect(createOrderThroughCircuitB(upper, context)).rejects.toMatchObject({
      code: "INVALID_TURNSTILE",
    });

    expect(mocks.checkGlobalPublicRequestGate).toHaveBeenCalledTimes(2);
    expect(mocks.checkGlobalPublicRequestGate.mock.calls[0][0].behaviorHash).toBe(
      mocks.checkGlobalPublicRequestGate.mock.calls[1][0].behaviorHash,
    );
  });

  it("returns the prior order for an idempotent replay without reusing Turnstile", async () => {
    mocks.checkPublicOrderIntakeAvailability.mockResolvedValue({
      ok: false,
      code: "QR_ORDERING_DEGRADED",
    });
    mocks.preflightPublicOrder.mockResolvedValue({
      ok: true,
      idempotent_order: {
        order_id: "33333333-3333-4333-8333-333333333333",
        order_no: "A001",
        order_status: "WAITING_CONFIRMATION",
        payment_status: "UNPAID",
        total_amount: 100,
        fulfillment_type: "TAKEOUT",
        pickup_required: true,
        pickup_code_length: 6,
        quoted_wait_minutes: 10,
        quoted_ready_at: "2026-07-29T00:10:00.000Z",
        created_at: "2026-07-29T00:00:00.000Z",
      },
    });
    mocks.persistPickupCodeDisplay.mockResolvedValue({ count: 1 });
    const { createOrderThroughCircuitB } = await import("./circuit-b-service");

    const result = await createOrderThroughCircuitB(validOrder(), {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      orderNo: "A001",
      orderStatus: "WAITING_CONFIRMATION",
    });
    expect(result.body.pickupVerificationCode).toHaveLength(6);
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.checkPublicOrderSubmissionGate).not.toHaveBeenCalled();
    expect(mocks.createPublicOrderWithSchedule).not.toHaveBeenCalled();
  });

  it("uses the requested fulfillment time for idempotent replay checks", async () => {
    const requestedFulfillmentAt = new Date("2099-08-03T04:00:00.000Z");
    const input = createPublicOrderSchema.parse({
      ...validOrder(),
      scheduledPickupAt: requestedFulfillmentAt.toISOString(),
    });
    mocks.preflightPublicOrder.mockResolvedValue({
      ok: true,
      idempotent_order: {
        order_id: "33333333-3333-4333-8333-333333333333",
        order_no: "A002",
        order_status: "WAITING_CONFIRMATION",
        payment_status: "UNPAID",
        total_amount: 100,
        fulfillment_type: "TAKEOUT",
        pickup_required: true,
        pickup_code_length: 3,
        quoted_wait_minutes: 10,
        quoted_ready_at: "2026-07-29T00:10:00.000Z",
        scheduled_pickup_at: null,
        requested_fulfillment_at: requestedFulfillmentAt.toISOString(),
        lottery_draw_id: null,
        discount_amount: 0,
        created_at: "2026-07-29T00:00:00.000Z",
      },
    });
    mocks.persistPickupCodeDisplay.mockResolvedValue({ count: 1 });
    const { createOrderThroughCircuitB } = await import("./circuit-b-service");

    const result = await createOrderThroughCircuitB(input, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      orderNo: "A002",
      requestedFulfillmentAt: requestedFulfillmentAt.toISOString(),
    });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.createPublicOrderWithSchedule).not.toHaveBeenCalled();
  });

  it("shows a scheduled-only legacy QR takeout as confirmed when tracking", async () => {
    const scheduledPickupAt = "2026-08-07T04:30:00.000Z";
    mocks.getTrackedPublicOrder.mockResolvedValue({
      orderId: "33333333-3333-4333-8333-333333333333",
      orderNo: "A003",
      orderStatus: "CONFIRMED",
      paymentStatus: "UNPAID",
      totalAmount: 100,
      createdAt: "2026-08-06T04:00:00.000Z",
      fulfillmentType: "TAKEOUT",
      pickupCodeLength: 3,
      scheduledPickupAt,
      requestedFulfillmentAt: null,
      committedFulfillmentAt: null,
      pendingFulfillmentAt: null,
      fulfillmentTimeState: "NOT_REQUESTED",
      fulfillmentTimeVersion: 0,
      items: [],
    });
    mocks.getTrackedOrderContext.mockResolvedValue({
      source: "QR_MENU",
      stallId: "88888888-8888-4888-8888-888888888888",
      diningTableId: null,
      quotedWaitMinutes: 10,
      quotedReadyAt: new Date("2026-08-06T04:10:00.000Z"),
      stall: { orderingSettings: { estimatedWaitMinutes: 15 } },
    });
    const { getOrderThroughCircuitB } = await import("./circuit-b-service");

    const result = await getOrderThroughCircuitB({
      trackingToken: "legacy-tracking-token",
      deviceId: "11111111-1111-4111-8111-111111111111",
    }, {
      clientIp: "203.0.113.8",
      requestId: "request-test",
      timing: timing(),
    });

    expect(result.body).toMatchObject({
      order: {
        scheduledPickupAt,
        requestedFulfillmentAt: scheduledPickupAt,
        committedFulfillmentAt: scheduledPickupAt,
        fulfillmentTimeState: "CONFIRMED",
        fulfillmentTimeVersion: 0,
      },
    });
  });
});
