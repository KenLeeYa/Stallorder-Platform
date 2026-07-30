import { beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimit = vi.fn();
const verifyAccountEvent = vi.fn();
const createProviderEvent = vi.fn();
const runTransaction = vi.fn();
const revokeAllProfileSessions = vi.fn();
const updateIdentity = vi.fn();

vi.mock("@/lib/auth", () => ({ revokeAllProfileSessions }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    oAuthProviderEvent: {
      create: createProviderEvent,
      updateMany: vi.fn(),
    },
    $transaction: runTransaction,
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/security", () => ({
  createRequestId: () => "request-001",
  hashClientIp: () => "hashed-client-ip",
}));
vi.mock("@/server/auth/oauth/provider-registry", () => ({
  getEnabledOAuthProviderAdapter: vi.fn().mockResolvedValue({
    verifyAccountEvent,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  verifyAccountEvent.mockResolvedValue({
    subject: "apple-provider-subject",
    eventType: "account-deleted",
    occurredAt: new Date("2026-07-30T00:00:00.000Z"),
  });
  createProviderEvent.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
  });
  runTransaction.mockImplementation(async (operation) => operation({
    authIdentity: {
      findUnique: vi.fn().mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        profileId: "33333333-3333-4333-8333-333333333333",
      }),
      update: updateIdentity,
    },
    auditLog: { create: vi.fn() },
    oAuthProviderEvent: { update: vi.fn() },
  }));
});

describe("Apple account events", () => {
  it("accepts Apple's payload field and revokes an account-deleted identity", async () => {
    const route = await import("./route");
    const signedPayload = "apple-signed-payload-value";
    const response = await route.POST(new Request(
      "https://example.test/api/auth/apple/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: signedPayload }),
      },
    ));

    expect(response.status).toBe(200);
    expect(verifyAccountEvent).toHaveBeenCalledWith(signedPayload);
    expect(updateIdentity).toHaveBeenCalledWith({
      where: { id: "22222222-2222-4222-8222-222222222222" },
      data: { revokedAt: expect.any(Date) },
    });
    expect(revokeAllProfileSessions).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      "APPLE_ACCOUNT_EVENT",
      expect.any(Object),
    );
  });
});
