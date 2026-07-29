import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderThroughCircuitB: vi.fn(),
}));

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
}));

describe("GET /api/public/orders/:trackingToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.getOrderThroughCircuitB.mockReset();
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
        `https://app.qidaigo.com/api/public/orders/${trackingToken}`,
        {
          headers: {
            referer: "https://app.qidaigo.com/order/example",
            "x-real-ip": "203.0.113.8",
            "x-stallorder-device-id": "11111111-1111-4111-8111-111111111111",
            "x-stallorder-protocol-version": "1",
          },
        },
      ),
      { params: Promise.resolve({ trackingToken }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getOrderThroughCircuitB).toHaveBeenCalledWith(
      {
        trackingToken,
        deviceId: "11111111-1111-4111-8111-111111111111",
      },
      expect.objectContaining({ clientIp: "203.0.113.8" }),
    );
  });
});
