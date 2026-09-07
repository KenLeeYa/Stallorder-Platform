import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  rateLimit: vi.fn(),
  trustedOrigin: vi.fn(),
  canonicalValidation: vi.fn(),
  findOrder: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw, order: { findUnique: mocks.findOrder } },
}));

vi.mock("@/server/public-order/canonical-tracking-validator", () => ({
  validateTrackedPublicOrderAtCanonicalEdge: mocks.canonicalValidation,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkPublicRateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/security", () => ({
  createRequestId: () => "fulfillment-time-request-id",
  hashClientIp: () => "source-ip-hash",
  getClientIp: () => "203.0.113.10",
  hashToken: () => "t".repeat(64),
  isTrustedOrigin: mocks.trustedOrigin,
}));

const trackingToken = `sto_${"a".repeat(43)}`;
const validBody = {
  deviceId: "11111111-1111-4111-8111-111111111111",
  version: 2,
  response: "ACCEPT",
};

function responseRequest(body: unknown = validBody) {
  return new Request(
    `https://app.qidaigo.com/api/public/orders/${trackingToken}/fulfillment-time`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/public/orders/:trackingToken/fulfillment-time", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ABUSE_HASH_SECRET", "test-abuse-secret");
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.canonicalValidation.mockResolvedValue({ outcome: "NOT_FOUND" });
    mocks.findOrder.mockResolvedValue({ deviceHash: "canonical-device-hash" });
    mocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 11,
      retryAfterSeconds: 60,
    });
    mocks.queryRaw.mockResolvedValue([{
      result: {
        ok: true,
        state: "CONFIRMED",
        version: 2,
        committedFulfillmentAt: "2026-08-06T11:30:00.000Z",
      },
    }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("hashes the tracking token and device before the service-role RPC", async () => {
    const expectedDeviceHash = createHmac("sha256", "test-abuse-secret")
      .update(`device:${validBody.deviceId}`)
      .digest("hex");
    const route = await import("./route");
    const response = await route.POST(responseRequest(), {
      params: Promise.resolve({ trackingToken }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      state: "CONFIRMED",
      version: 2,
    });
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.objectContaining({
      scope: "public-fulfillment-time-response",
      sourceIdentifier: "source-ip-hash",
      resourceIdentifier: `${"t".repeat(64)}:${expectedDeviceHash}`,
      sourceLimit: 60,
      resourceLimit: 12,
      windowMs: 15 * 60_000,
    }));
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    const query = mocks.queryRaw.mock.calls[0]?.[0] as { values?: unknown[] };
    expect(query.values).toEqual([
      "t".repeat(64),
      expectedDeviceHash,
      2,
      "ACCEPT",
    ]);
    expect(JSON.stringify(query)).not.toContain(trackingToken);
    expect(JSON.stringify(query)).not.toContain(validBody.deviceId);
  });

  it("maps a stale proposal to a conflict response", async () => {
    mocks.queryRaw.mockResolvedValue([{
      result: { ok: false, code: "FULFILLMENT_TIME_PROPOSAL_STALE" },
    }]);
    const route = await import("./route");
    const response = await route.POST(responseRequest(), {
      params: Promise.resolve({ trackingToken }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "FULFILLMENT_TIME_PROPOSAL_STALE",
      error: "此時間提議已更新，請重新整理訂單後再確認。",
    });
  });

  it.each(["ACCEPT", "DECLINE"])("recovers %s only after canonical token AND device validation", async (choice) => {
    mocks.queryRaw.mockResolvedValueOnce([{ result: { ok: false, code: "ORDER_NOT_FOUND" } }]);
    mocks.canonicalValidation.mockResolvedValue({ outcome: "AUTHORIZED" });
    const route = await import("./route");
    const response = await route.POST(responseRequest({ ...validBody, response: choice }), {
      params: Promise.resolve({ trackingToken }),
    });

    expect(response.status).toBe(200);
    expect(mocks.canonicalValidation).toHaveBeenCalledWith({
      trackingToken, deviceId: validBody.deviceId,
      clientIp: "203.0.113.10", operationId: "fulfillment-time-request-id",
    });
    expect(mocks.findOrder).toHaveBeenCalledWith({
      where: { trackingTokenHash: "t".repeat(64) }, select: { deviceHash: true },
    });
    expect(mocks.queryRaw.mock.calls[1][0].values).toEqual([
      "t".repeat(64), "canonical-device-hash", 2, choice,
    ]);
  });

  it.each([
    ["NOT_FOUND", 404, "ORDER_NOT_FOUND"],
    ["UNAVAILABLE", 503, "FULFILLMENT_TIME_SERVICE_UNAVAILABLE"],
  ])("fails closed for canonical %s without looking up a token alone", async (outcome, status, code) => {
    mocks.queryRaw.mockResolvedValueOnce([{ result: { ok: false, code: "ORDER_NOT_FOUND" } }]);
    mocks.canonicalValidation.mockResolvedValue({ outcome });
    const route = await import("./route");
    const response = await route.POST(responseRequest(), {
      params: Promise.resolve({ trackingToken }),
    });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
    expect(mocks.findOrder).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it.each([
    ["FULFILLMENT_TIME_PROPOSAL_STALE", 409],
    ["FULFILLMENT_TIME_PROPOSAL_EXPIRED", 409],
    ["FULFILLMENT_TIME_UNAVAILABLE", 409],
  ])("preserves %s from the locked RPC after canonical recovery", async (code, status) => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ result: { ok: false, code: "ORDER_NOT_FOUND" } }])
      .mockResolvedValueOnce([{ result: { ok: false, code } }]);
    mocks.canonicalValidation.mockResolvedValue({ outcome: "AUTHORIZED" });
    const route = await import("./route");
    const response = await route.POST(responseRequest(), {
      params: Promise.resolve({ trackingToken }),
    });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
  });

  it("rejects an untrusted origin before rate-limit or database access", async () => {
    mocks.trustedOrigin.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(responseRequest(), {
      params: Promise.resolve({ trackingToken }),
    });

    expect(response.status).toBe(403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("rejects malformed response data before database access", async () => {
    const route = await import("./route");
    const response = await route.POST(responseRequest({
      ...validBody,
      version: 0,
      response: "MAYBE",
    }), {
      params: Promise.resolve({ trackingToken }),
    });

    expect(response.status).toBe(400);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns retry-after when the bounded response rate is exceeded", async () => {
    mocks.rateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 91,
    });
    const route = await import("./route");
    const response = await route.POST(responseRequest(), {
      params: Promise.resolve({ trackingToken }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("91");
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("fails closed when the device hashing secret is unavailable", async () => {
    vi.stubEnv("ABUSE_HASH_SECRET", "");
    const route = await import("./route");
    const response = await route.POST(responseRequest(), {
      params: Promise.resolve({ trackingToken }),
    });

    expect(response.status).toBe(503);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
