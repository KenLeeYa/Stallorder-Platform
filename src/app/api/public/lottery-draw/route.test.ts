import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  trustedOrigin: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

vi.mock("@/lib/security", () => ({
  createRequestId: () => "lottery-request-id",
  hashToken: () => "s".repeat(64),
  isTrustedOrigin: mocks.trustedOrigin,
}));

const validBody = {
  orderSessionToken: `stos_${"a".repeat(43)}`,
  deviceId: "11111111-1111-4111-8111-111111111111",
};

function drawRequest(body: unknown = validBody) {
  return new Request("https://app.qidaigo.com/api/public/lottery-draw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/public/lottery-draw", () => {
  beforeEach(() => {
    vi.stubEnv("ABUSE_HASH_SECRET", "test-abuse-secret");
    mocks.trustedOrigin.mockReturnValue(true);
    mocks.queryRaw.mockResolvedValue([{
      result: {
        ok: true,
        drawId: "22222222-2222-4222-8222-222222222222",
        productId: "33333333-3333-4333-8333-333333333333",
        productName: "招牌餐點",
        bestSellerRank: 1,
        recommendationBasis: "BEST_SELLER",
        recommendationStrategy: "POPULARITY_30D",
        discountWon: false,
      },
    }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns the server-authoritative draw without caching", async () => {
    const route = await import("./route");
    const response = await route.POST(drawRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      productName: "招牌餐點",
      bestSellerRank: 1,
      recommendationBasis: "BEST_SELLER",
      recommendationStrategy: "POPULARITY_30D",
    });
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it("uses the shared public-order status and message contract", async () => {
    mocks.queryRaw.mockResolvedValue([{
      result: { ok: false, code: "LOTTERY_RATE_LIMITED" },
    }]);
    const route = await import("./route");
    const response = await route.POST(drawRequest());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      code: "LOTTERY_RATE_LIMITED",
      error: "今日抽抽樂次數已達上限，請稍後再試。",
    });
  });

  it("rejects an untrusted origin before database access", async () => {
    mocks.trustedOrigin.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(drawRequest());

    expect(response.status).toBe(403);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("fails closed when the abuse hashing secret is unavailable", async () => {
    vi.stubEnv("ABUSE_HASH_SECRET", "");
    const route = await import("./route");
    const response = await route.POST(drawRequest());

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
