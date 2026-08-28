import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestPrincipal = vi.fn();
const validateCsrf = vi.fn();
const findSession = vi.fn();
const runTransaction = vi.fn();
const findIdentity = vi.fn();
const countOtherIdentities = vi.fn();
const findInvitation = vi.fn();
const checkRateLimit = vi.fn();
const createOAuthTransaction = vi.fn();
const getEnabledOAuthProviderAdapter = vi.fn();

vi.mock("@/lib/auth", () => ({
  clearSessionCookies: vi.fn(),
  getRequestPrincipal,
  revokeAllProfileSessions: vi.fn(),
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    authSession: { findUnique: findSession },
    authIdentityLinkInvitation: { findUnique: findInvitation },
    $transaction: runTransaction,
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/security", () => ({
  createRequestId: vi.fn(() => "request-1"),
  hashClientIp: vi.fn(() => "ip-hash"),
  hashToken: vi.fn((value: string) => `hash:${value}`),
  isTrustedOrigin: vi.fn(() => true),
  sanitizeRedirectPath: vi.fn((value: string | undefined, fallback: string) => value ?? fallback),
}));
vi.mock("@/server/auth/oauth/provider-registry", () => ({
  getEnabledOAuthProviderAdapter,
  getOAuthRedirectUri: vi.fn(() => "https://example.test/api/auth/google/callback"),
}));
vi.mock("@/server/auth/oauth/transaction-service", () => ({
  createOAuthTransaction,
}));
vi.mock("@/server/auth/oauth/feature-flags", () => ({
  resolveOAuthFeatureState: vi.fn().mockResolvedValue({
    foundation: true,
    linking: true,
    provider: true,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getRequestPrincipal.mockResolvedValue({
    sessionId: "11111111-1111-4111-8111-111111111111",
    csrfTokenHash: "csrf-hash",
    user: {
      id: "22222222-2222-4222-8222-222222222222",
      authUserId: null,
      email: "owner@example.test",
      displayName: "測試擁有者",
      platformRole: null,
    },
  });
  validateCsrf.mockReturnValue(true);
  findSession.mockResolvedValue({
    issuedAt: new Date(),
    revokedAt: null,
  });
  findIdentity.mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    providerSubject: "provider-subject",
    revokedAt: null,
  });
  countOtherIdentities.mockResolvedValue(0);
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  findInvitation.mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    profileId: "22222222-2222-4222-8222-222222222222",
    allowedProviders: ["GOOGLE"],
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    revokedAt: null,
  });
  createOAuthTransaction.mockResolvedValue({
    transactionId: "66666666-6666-4666-8666-666666666666",
    state: "state",
    nonce: "nonce",
    codeChallenge: "challenge",
  });
  getEnabledOAuthProviderAdapter.mockResolvedValue({
    buildAuthorizationUrl: vi.fn(() => new URL("https://provider.example.test/authorize")),
  });
  runTransaction.mockImplementation(async (operation) => operation({
    authIdentity: {
      findUnique: findIdentity,
      count: countOtherIdentities,
    },
    profile: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ passwordHash: "legacy-password-hash" }),
    },
  }));
});

describe("OAuth identity unlinking", () => {
  it("keeps the last active provider even while a legacy password hash exists", async () => {
    const route = await import("./route");
    const response = await route.DELETE(
      new Request("https://example.test/api/auth/identities/google", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ provider: "google" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "至少需保留一個可用的登入方式。",
    });
  });
});

describe("OAuth identity invitation linking", () => {
  const token = "a".repeat(40);

  function request() {
    return new Request("https://example.test/api/auth/identities/google", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.test",
      },
      body: JSON.stringify({ invitationToken: token }),
    });
  }

  it("rejects invitation redemption without the invited account session", async () => {
    getRequestPrincipal.mockResolvedValue(null);
    const route = await import("./route");

    const response = await route.POST(request(), { params: Promise.resolve({ provider: "google" }) });

    expect(response.status).toBe(404);
    expect(createOAuthTransaction).not.toHaveBeenCalled();
  });

  it("rejects invitation redemption from a different account", async () => {
    getRequestPrincipal.mockResolvedValue({
      sessionId: "11111111-1111-4111-8111-111111111111",
      csrfTokenHash: "csrf-hash",
      user: {
        id: "77777777-7777-4777-8777-777777777777",
        authUserId: null,
        email: "other@example.test",
        displayName: "Other",
        platformRole: null,
      },
    });
    const route = await import("./route");

    const response = await route.POST(request(), { params: Promise.resolve({ provider: "google" }) });

    expect(response.status).toBe(404);
    expect(createOAuthTransaction).not.toHaveBeenCalled();
  });

  it("binds the OAuth transaction to the recently authenticated target profile", async () => {
    const route = await import("./route");

    const response = await route.POST(request(), { params: Promise.resolve({ provider: "google" }) });

    expect(response.status).toBe(200);
    expect(createOAuthTransaction).toHaveBeenCalledWith(expect.objectContaining({
      currentProfileId: "22222222-2222-4222-8222-222222222222",
      invitationId: "55555555-5555-4555-8555-555555555555",
    }));
  });
});
