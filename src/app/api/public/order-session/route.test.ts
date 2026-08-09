import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueOrderSessionThroughCircuitB: vi.fn(),
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
  issueOrderSessionThroughCircuitB: mocks.issueOrderSessionThroughCircuitB,
}));

describe("POST /api/public/order-session", () => {
  beforeEach(() => {
    vi.stubEnv("TRUSTED_APP_ORIGINS", testOrigin);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mocks.issueOrderSessionThroughCircuitB.mockReset();
  });

  it("keeps the client session request id for cross-circuit replay", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.issueOrderSessionThroughCircuitB.mockResolvedValue({
      status: 201,
      body: { orderSessionToken: "stos_result" },
    });
    const body = {
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DEFAULT",
      includeMenu: true,
    };
    const route = await import("./route");
    const response = await route.POST(new Request(
      `${testOrigin}/api/public/order-session`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: testOrigin,
          "x-real-ip": "203.0.113.8",
          "x-stallorder-protocol-version": "1",
          "x-stallorder-operation-id": operationId,
        },
        body: JSON.stringify(body),
      },
    ));

    expect(response.status).toBe(201);
    expect(response.headers.get("x-stallorder-operation-id")).toBe(operationId);
    expect(response.headers.get("x-request-id")).not.toBe(operationId);
    expect(mocks.issueOrderSessionThroughCircuitB).toHaveBeenCalledWith(
      body,
      expect.objectContaining({ clientIp: "203.0.113.8" }),
    );
  });
});
