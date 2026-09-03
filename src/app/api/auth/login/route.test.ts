import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  resetRateLimitBucket: vi.fn(),
  resolveOAuthState: vi.fn(),
  findProfile: vi.fn(),
  updateProfile: vi.fn(),
  verifyPassword: vi.fn(),
  createSession: vi.fn(),
  setSessionCookies: vi.fn(),
  recordAuditEvent: vi.fn(),
  localQuickLoginAllowed: vi.fn(() => false),
}));

vi.mock("@/lib/auth", () => ({
  createSession: mocks.createSession,
  defaultPathForRole: vi.fn(() => "/staff/demo"),
  setSessionCookies: mocks.setSessionCookies,
}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/http", () => ({ readJson: vi.fn(async (request: Request) => ({ data: await request.json() })) }));
vi.mock("@/lib/device-label", () => ({ getRequestDeviceLabel: vi.fn(() => "Test device") }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: { findUnique: mocks.findProfile, update: mocks.updateProfile },
  },
}));
vi.mock("@/lib/password-auth", () => ({ verifyPasswordCredential: mocks.verifyPassword }));
vi.mock("@/lib/performance-timing", () => ({
  createPerformanceTiming: vi.fn(() => ({
    measureDb: (load: () => unknown) => load(),
    measure: (_key: string, load: () => unknown) => load(),
  })),
  finalizePerformanceResponse: vi.fn((response: Response) => response),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  resetRateLimitBucket: mocks.resetRateLimitBucket,
}));
vi.mock("@/lib/security", () => ({
  createRequestId: vi.fn(() => "request-1"),
  hashClientIp: vi.fn(() => "ip-hash"),
  hashClientUserAgent: vi.fn(() => "ua-hash"),
  hashToken: vi.fn(() => "account-hash"),
  isLocalQaLoginRateLimitDisabled: vi.fn(() => false),
  isLocalQaQuickLoginAllowed: mocks.localQuickLoginAllowed,
  isTrustedOrigin: vi.fn(() => true),
  resolveSessionDeviceId: vi.fn(() => "device-1"),
  sanitizeRedirectPath: vi.fn((_next: string | undefined, fallback: string) => fallback),
}));
vi.mock("@/lib/workspace", () => ({
  getDefaultWorkspacePath: vi.fn(() => "/merchant/dashboard?organizationId=org-1"),
  getWorkspaceAccess: vi.fn(async () => [{ id: "org-1" }]),
}));
vi.mock("@/server/auth/oauth/feature-flags", () => ({ resolveOAuthLoginFeatureState: mocks.resolveOAuthState }));
vi.mock("@/server/merchant-applications/merchant-setup-service", () => ({
  getPendingMerchantSetupPath: vi.fn(async () => null),
}));

describe("password login anti-lockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 60 });
    mocks.resetRateLimitBucket.mockResolvedValue(undefined);
    mocks.resolveOAuthState.mockResolvedValue({ oauthOnly: false });
    mocks.localQuickLoginAllowed.mockReturnValue(false);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.createSession.mockResolvedValue({ token: "session" });
    mocks.findProfile.mockResolvedValue(validProfile());
    mocks.updateProfile.mockResolvedValue({});
  });

  it("rejects at the source-IP gate before OAuth or credential database work", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    const route = await import("./route");
    const response = await route.POST(loginRequest());
    expect(response.status).toBe(429);
    expect(mocks.resolveOAuthState).not.toHaveBeenCalled();
    expect(mocks.findProfile).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it("does not let an account-failure bucket block a correct password", async () => {
    const route = await import("./route");
    const response = await route.POST(loginRequest());
    expect(response.status).toBe(200);
    expect(mocks.checkRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.resetRateLimitBucket).toHaveBeenCalledTimes(2);
  });

  it("applies account failure limits only after password verification fails", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    mocks.checkRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 10, retryAfterSeconds: 60 })
      .mockResolvedValueOnce({ allowed: true, remaining: 0, retryAfterSeconds: 60 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    const route = await import("./route");
    const response = await route.POST(loginRequest());
    expect(response.status).toBe(429);
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("allows only the guarded local QA account when the platform is OAuth-only", async () => {
    mocks.resolveOAuthState.mockResolvedValue({ oauthOnly: true });
    mocks.localQuickLoginAllowed.mockReturnValue(true);
    const route = await import("./route");

    const response = await route.POST(loginRequest());

    expect(response.status).toBe(200);
    expect(mocks.localQuickLoginAllowed).toHaveBeenCalledWith(
      expect.any(Request),
      "owner@example.test",
    );
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it("keeps OAuth-only password rejection when the local QA guard is not satisfied", async () => {
    mocks.resolveOAuthState.mockResolvedValue({ oauthOnly: true });
    const route = await import("./route");

    const response = await route.POST(loginRequest());

    expect(response.status).toBe(403);
    expect(mocks.findProfile).not.toHaveBeenCalled();
  });
});

function validProfile() {
  return {
    id: "profile-1",
    isActive: true,
    platformRole: null,
    passwordHash: "hash",
    organizationMemberships: [{ organizationId: "org-1" }],
    stallMemberships: [],
  };
}

function loginRequest() {
  return new Request("https://example.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ email: "owner@example.test", password: "correct-password" }),
  });
}
