import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  rateLimit: vi.fn(),
  trustedOrigin: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/security", () => ({
  createRequestId: () => "fulfillment-time-request-id",
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
    vi.stubEnv("ABUSE_HASH_SECRET", "test-abuse-secret");
    mocks.trustedOrigin.mockReturnValue(true);
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
      limit: 12,
    }));
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    const query = mocks.queryRaw.mock.calls[0]?.[0] as { values?: unknown[] };
    expect(query.values).toEqual([
      "t".repeat(64),
      createHmac("sha256", "test-abuse-secret")
        .update(`device:${validBody.deviceId}`)
        .digest("hex"),
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
