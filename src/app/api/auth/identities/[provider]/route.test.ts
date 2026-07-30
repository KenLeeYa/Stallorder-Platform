import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestPrincipal = vi.fn();
const validateCsrf = vi.fn();
const findSession = vi.fn();
const runTransaction = vi.fn();
const findIdentity = vi.fn();
const countOtherIdentities = vi.fn();

vi.mock("@/lib/auth", () => ({
  clearSessionCookies: vi.fn(),
  getRequestPrincipal,
  revokeAllProfileSessions: vi.fn(),
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    authSession: { findUnique: findSession },
    $transaction: runTransaction,
  },
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
