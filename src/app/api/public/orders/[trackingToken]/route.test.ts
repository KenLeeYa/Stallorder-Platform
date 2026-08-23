import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderThroughCircuitB: vi.fn(),
  editOrderThroughCircuitB: vi.fn(),
  cancelOrderThroughCircuitB: vi.fn(),
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
  getOrderThroughCircuitB: mocks.getOrderThroughCircuitB,
  editOrderThroughCircuitB: mocks.editOrderThroughCircuitB,
  cancelOrderThroughCircuitB: mocks.cancelOrderThroughCircuitB,
}));

describe("GET /api/public/orders/:trackingToken", () => {
  beforeEach(() => {
    vi.stubEnv("TRUSTED_APP_ORIGINS", testOrigin);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mocks.getOrderThroughCircuitB.mockReset();
    mocks.editOrderThroughCircuitB.mockReset();
    mocks.cancelOrderThroughCircuitB.mockReset();
  });

  it("binds a tracking read to the device header", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.getOrderThroughCircuitB.mockResolvedValue({
      status: 200,
      body: { order: { orderNo: "A001" } },
    });
    const trackingToken = `sto_${"a".repeat(43)}`;
    const route = await import("./route");
    const response = await route.GET(
      new Request(
        `${testOrigin}/api/public/orders/${trackingToken}`,
        {
          headers: {
            referer: `${testOrigin}/order/example`,
            "x-real-ip": "203.0.113.8",
            "x-stallorder-device-id": "11111111-1111-4111-8111-111111111111",
            "x-stallorder-protocol-version": "1",
            "x-stallorder-operation-id": operationId,
          },
        },
      ),
      { params: Promise.resolve({ trackingToken }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-stallorder-operation-id")).toBe(operationId);
    expect(response.headers.get("x-request-id")).not.toBe(operationId);
    expect(mocks.getOrderThroughCircuitB).toHaveBeenCalledWith(
      {
        trackingToken,
        deviceId: "11111111-1111-4111-8111-111111111111",
      },
      expect.objectContaining({ clientIp: "203.0.113.8" }),
    );
  });

  it("binds order modification to the tracking token and current device", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.editOrderThroughCircuitB.mockResolvedValue({
      status: 200,
      body: { trackingToken: `sto_${"a".repeat(43)}`, orderStatus: "WAITING_CONFIRMATION" },
    });
    const trackingToken = `sto_${"a".repeat(43)}`;
    const route = await import("./route");
    const response = await route.PATCH(
      new Request(`${testOrigin}/api/public/orders/${trackingToken}`, {
        method: "PATCH",
        headers: {
          referer: `${testOrigin}/order/example`,
          "content-type": "application/json",
          "x-real-ip": "203.0.113.8",
          "x-stallorder-protocol-version": "1",
          "x-stallorder-operation-id": operationId,
        },
        body: JSON.stringify({
          deviceId: "11111111-1111-4111-8111-111111111111",
          idempotencyKey: "22222222-2222-4222-8222-222222222222",
          turnstileToken: "verified-token",
          items: [{ productId: "33333333-3333-4333-8333-333333333333", quantity: 2, note: "", noteOptionIds: [], bundleChoiceIds: [] }],
        }),
      }),
      { params: Promise.resolve({ trackingToken }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.editOrderThroughCircuitB).toHaveBeenCalledWith(
      expect.objectContaining({ trackingToken, deviceId: "11111111-1111-4111-8111-111111111111" }),
      expect.objectContaining({ clientIp: "203.0.113.8" }),
    );
  });

  it("allows cancellation only through the authenticated tracked-order command", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.cancelOrderThroughCircuitB.mockResolvedValue({
      status: 200,
      body: { orderStatus: "CANCELLED" },
    });
    const trackingToken = `sto_${"a".repeat(43)}`;
    const route = await import("./route");
    const response = await route.DELETE(
      new Request(`${testOrigin}/api/public/orders/${trackingToken}`, {
        method: "DELETE",
        headers: {
          referer: `${testOrigin}/order/example`,
          "content-type": "application/json",
          "x-real-ip": "203.0.113.8",
          "x-stallorder-protocol-version": "1",
          "x-stallorder-operation-id": operationId,
        },
        body: JSON.stringify({ deviceId: "11111111-1111-4111-8111-111111111111" }),
      }),
      { params: Promise.resolve({ trackingToken }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.cancelOrderThroughCircuitB).toHaveBeenCalledWith(
      { trackingToken, deviceId: "11111111-1111-4111-8111-111111111111" },
      expect.objectContaining({ clientIp: "203.0.113.8" }),
    );
  });
});
