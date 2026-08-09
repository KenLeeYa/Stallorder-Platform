import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrderThroughCircuitB: vi.fn(),
}));
const testOrigin = "https://app.qidaigo.com";
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@/server/public-order/circuit-b-service", () => ({
  PublicOrderCircuitError: class PublicOrderCircuitError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      public readonly responseBody?: Record<string, unknown>,
    ) {
      super(code);
    }
  },
  createOrderThroughCircuitB: mocks.createOrderThroughCircuitB,
}));

const validOrder = {
  qrToken: "demo-aming-chicken-qr-2026-rotate-me",
  orderSessionToken: `stos_${"a".repeat(43)}`,
  deviceId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  clientOrderId: "33333333-3333-4333-8333-333333333333",
  turnstileIdempotencyKey: "44444444-4444-4444-8444-444444444444",
  customerName: "",
  customerPhone: "",
  deliveryAddress: "",
  customerNote: "",
  waitAcknowledged: false,
  orderingMode: "DEFAULT",
  scheduledPickupAt: null,
  lotteryDrawId: null,
  items: [{
    productId: "55555555-5555-4555-8555-555555555555",
    quantity: 1,
    note: "",
    noteOptionIds: [],
    bundleChoiceIds: [],
  }],
  turnstileToken: "turnstile-test-token",
};

function orderRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${testOrigin}/api/public/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: testOrigin,
      "x-real-ip": "203.0.113.8",
      "x-stallorder-protocol-version": "1",
      "x-stallorder-operation-id": operationId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/public/orders", () => {
  beforeEach(() => {
    vi.stubEnv("TRUSTED_APP_ORIGINS", testOrigin);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createOrderThroughCircuitB.mockResolvedValue({
      status: 201,
      body: { trackingToken: "sto_result" },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mocks.createOrderThroughCircuitB.mockReset();
  });

  it("validates and forwards one trusted order command", async () => {
    const route = await import("./route");
    const response = await route.POST(orderRequest(validOrder));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-order-circuit")).toBe("B");
    expect(response.headers.get("x-stallorder-operation-id")).toBe(operationId);
    expect(response.headers.get("x-request-id")).not.toBe(operationId);
    expect(mocks.createOrderThroughCircuitB).toHaveBeenCalledWith(
      validOrder,
      expect.objectContaining({
        clientIp: "203.0.113.8",
        requestId: expect.any(String),
      }),
    );
  });

  it("rejects a cross-site origin before invoking the trusted service", async () => {
    const route = await import("./route");
    const response = await route.POST(orderRequest(validOrder, {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(mocks.createOrderThroughCircuitB).not.toHaveBeenCalled();
  });

  it("rejects an unsupported protocol and unknown properties", async () => {
    const route = await import("./route");
    const staleClient = await route.POST(orderRequest(validOrder, {
      "x-stallorder-protocol-version": "0",
    }));
    expect(staleClient.status).toBe(426);

    const tampered = await route.POST(orderRequest({
      ...validOrder,
      organizationId: "66666666-6666-4666-8666-666666666666",
    }));
    expect(tampered.status).toBe(400);
    expect(mocks.createOrderThroughCircuitB).not.toHaveBeenCalled();
  });
});
