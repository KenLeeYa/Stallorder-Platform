import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  lineLinkFindFirst: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  readSecret: vi.fn(),
  exchangeAuthorization: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkPublicRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/security", () => ({
  createRequestId: () => "request-id",
  hashClientIp: () => "ip-hash",
  hashToken: (value: string) => `hash:${value}`,
}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lineLinkSession: { findFirst: mocks.lineLinkFindFirst },
  },
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: { assertFeatureEnabled: mocks.assertFeatureEnabled },
}));
vi.mock("@/server/notifications/line-oauth", () => ({
  exchangeAndVerifyLineAuthorization: mocks.exchangeAuthorization,
}));
vi.mock("@/server/notifications/notification-secrets", () => ({
  readNotificationSecret: mocks.readSecret,
  storeNotificationSecret: vi.fn(),
  deleteNotificationSecret: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.assertFeatureEnabled.mockResolvedValue({});
  mocks.lineLinkFindFirst.mockResolvedValue({
    id: "session-id",
    organizationId: "11111111-1111-4111-8111-111111111111",
    stallId: "22222222-2222-4222-8222-222222222222",
    orderId: "33333333-3333-4333-8333-333333333333",
    integrationId: "integration-id",
    ephemeralSecretReference: "ephemeral-ref",
    integration: {
      status: "ACTIVE",
      publicIdentifier: "line-channel-id",
      secretReference: "integration-ref",
    },
    order: { status: "PENDING" },
  });
  mocks.readSecret
    .mockResolvedValueOnce(JSON.stringify({
      redirectUri: "https://trusted.example/api/public/line/callback",
      trackingToken: "sto_secret-tracking-token-that-must-not-leak",
      codeVerifier: "v".repeat(43),
      nonce: "n".repeat(32),
    }))
    .mockResolvedValueOnce(JSON.stringify({
      channelAccessToken: "line-access-token-value",
      messagingChannelSecret: "line-messaging-secret-value",
      loginChannelSecret: "line-login-secret-value",
    }));
});

describe("LINE callback redirect binding", () => {
  it("拒絕不同來源的 callback，且不把訂單權杖帶到重新導向網址", async () => {
    const route = await import("./route");
    const state = "s".repeat(40);

    const response = await route.GET(new Request(
      `https://untrusted.example/api/public/line/callback?state=${state}&code=authorization-code`,
    ));

    expect(response.status).toBe(409);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "LINE 綁定來源不符，請回到訂單頁重新操作。",
      code: "LINE_LINK_FAILED",
    });
    expect(mocks.exchangeAuthorization).not.toHaveBeenCalled();
  });
});
