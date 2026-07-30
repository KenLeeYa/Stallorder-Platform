import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeApiRequest: vi.fn(),
  validateCsrf: vi.fn(),
  checkRateLimit: vi.fn(),
  importOfflineSyncBatch: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeApiRequest: mocks.authorizeApiRequest,
}));
vi.mock("@/lib/csrf", () => ({
  validateCsrf: mocks.validateCsrf,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/security", () => ({
  hashClientIp: () => "hashed-client-ip",
}));
vi.mock("@/server/billing/entitlement-http", () => ({
  entitlementErrorResponse: () => null,
}));
vi.mock("@/server/offline/offline-http", () => ({
  offlineErrorResponse: () => null,
  offlineNoStoreHeaders: (requestId: string) => ({
    "cache-control": "private, no-store",
    "x-request-id": requestId,
  }),
}));
vi.mock("@/server/offline/offline-sync-service", () => ({
  importOfflineSyncBatch: mocks.importOfflineSyncBatch,
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";

const validRequest = {
  installationId: "44444444-4444-4444-8444-444444444444",
  permitToken: "p".repeat(64),
  appProtocolVersion: "2",
  clientSentAt: "2026-07-29T10:00:00.000Z",
  records: [{
    recordType: "CASH_EVENT",
    queueId: "55555555-5555-4555-8555-555555555555",
    event: {
      cashEventId: "66666666-6666-4666-8666-666666666666",
      deviceId: "77777777-7777-4777-8777-777777777777",
      organizationId,
      stallId,
      cashShiftId: "88888888-8888-4888-8888-888888888888",
      eventType: "CASH_IN",
      amount: 100,
      countedAmount: null,
      reason: "補入零用金",
      occurredAtDevice: "2026-07-29T09:59:00.000Z",
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
      promotionEpoch: "1",
      protocolVersion: "2",
    },
  }],
};

function request(body: unknown, stallSlug = "safe-stall") {
  return new Request("https://app.qidaigo.com/api/offline/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stall-slug": stallSlug,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/offline/sync", () => {
  beforeEach(() => {
    mocks.authorizeApiRequest.mockResolvedValue({
      ok: true,
      requestId: "request-1",
      principal: { user: { id: profileId } },
      stall: { id: stallId, organizationId },
      roles: ["STAFF"],
    });
    mocks.validateCsrf.mockReturnValue(true);
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    mocks.importOfflineSyncBatch.mockResolvedValue({
      receipts: [],
      serverTime: "2026-07-29T10:00:01.000Z",
      promotionEpoch: "1",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a malformed Stall scope before authorization", async () => {
    const route = await import("./route");
    const response = await route.POST(request(validRequest, "../other-stall"));

    expect(response.status).toBe(400);
    expect(mocks.authorizeApiRequest).not.toHaveBeenCalled();
  });

  it("requires CSRF before parsing or importing records", async () => {
    mocks.validateCsrf.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(request(validRequest));

    expect(response.status).toBe(403);
    expect(mocks.importOfflineSyncBatch).not.toHaveBeenCalled();
  });

  it("rejects unknown tenant parameters instead of trusting client scope", async () => {
    const route = await import("./route");
    const response = await route.POST(request({
      ...validRequest,
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }));

    expect(response.status).toBe(400);
    expect(mocks.importOfflineSyncBatch).not.toHaveBeenCalled();
  });

  it("imports a bounded batch with server-derived actor and Stall scope", async () => {
    const route = await import("./route");
    const response = await route.POST(request(validRequest));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.importOfflineSyncBatch).toHaveBeenCalledWith({
      organizationId,
      stallId,
      installationId: validRequest.installationId,
      permitToken: validRequest.permitToken,
      clientSentAt: validRequest.clientSentAt,
      records: validRequest.records,
      actor: {
        profileId,
        roles: ["STAFF"],
        requestId: "request-1",
        ipHash: "hashed-client-ip",
      },
    });
  });

  it("enforces both device and IP rate limits", async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const route = await import("./route");
    const response = await route.POST(request(validRequest));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(mocks.importOfflineSyncBatch).not.toHaveBeenCalled();
  });
});
