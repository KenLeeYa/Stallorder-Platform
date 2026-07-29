import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { createPublicOrderSchema } from "../../../supabase/functions/_shared/schemas";

const mocks = vi.hoisted(() => ({
  resolveResilienceFeatureFlags: vi.fn(),
  verifyTurnstile: vi.fn(),
  getCachedPublicMenuForQrToken: vi.fn(),
  checkGlobalPublicRequestGate: vi.fn(),
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

  it("returns the prior order for an idempotent replay without reusing Turnstile", async () => {
    mocks.lookupPublicOrderIdempotency.mockResolvedValue({
      order_id: "33333333-3333-4333-8333-333333333333",
      order_no: "A001",
      order_status: "WAITING_CONFIRMATION",
      payment_status: "UNPAID",
      total_amount: 100,
      fulfillment_type: "TAKEOUT",
      pickup_required: true,
      created_at: "2026-07-29T00:00:00.000Z",
    });
    mocks.getOrderQuote.mockResolvedValue({
      fulfillmentType: "TAKEOUT",
      pickupCodeLength: 3,
      quotedWaitMinutes: 10,
      quotedReadyAt: new Date("2026-07-29T00:10:00.000Z"),
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
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.checkPublicOrderSubmissionGate).not.toHaveBeenCalled();
    expect(mocks.createPublicOrderWithSchedule).not.toHaveBeenCalled();
  });
});
