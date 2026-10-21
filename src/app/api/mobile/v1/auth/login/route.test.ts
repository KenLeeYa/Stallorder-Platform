import { beforeEach, describe, expect, it, vi } from "vitest";

const createSession = vi.fn();
const recordAuditEvent = vi.fn();
const verifyPasswordCredential = vi.fn();
const findProfile = vi.fn();
const updateProfile = vi.fn();
const checkRateLimit = vi.fn();
const resolveOAuthLoginFeatureState = vi.fn();
const resolveMobileFeatureState = vi.fn();

vi.mock("@/lib/auth", () => ({ createSession, SESSION_COOKIE:"stallorder_session" }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));
vi.mock("@/lib/password-auth", () => ({ verifyPasswordCredential }));
vi.mock("@/lib/prisma", () => ({
  prisma: { profile: { findUnique: findProfile, update: updateProfile } },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/server/auth/oauth/feature-flags", () => ({ resolveOAuthLoginFeatureState }));
vi.mock("@/server/mobile/feature-flags", () => ({ resolveMobileFeatureState, isLocalMobilePilot:()=>false }));

const enabledFlags = {
  mobileApp: true,
  platformAdmin: false,
  push: false,
  offlinePos: false,
  directPrint: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveMobileFeatureState.mockResolvedValue(enabledFlags);
  resolveOAuthLoginFeatureState.mockResolvedValue({ oauthOnly: false, passwordEnabled:true });
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  verifyPasswordCredential.mockResolvedValue(true);
  findProfile.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    isActive: true,
    passwordHash: "password-hash",
    platformRole: null,
    organizationMemberships: [{ organizationId: "22222222-2222-4222-8222-222222222222" }],
    stallMemberships: [],
  });
  createSession.mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    token: "s".repeat(43),
    expiresAt: new Date("2026-08-25T12:00:00.000Z"),
  });
  updateProfile.mockResolvedValue({});
  recordAuditEvent.mockResolvedValue(undefined);
});

function loginRequest(body: Record<string, unknown>) {
  return new Request("https://example.test/api/mobile/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/v1/auth/login", () => {
  it("fails closed when password policy is disabled even outside OAuth-only mode", async () => {
    resolveOAuthLoginFeatureState.mockResolvedValue({oauthOnly:false,passwordEnabled:false});
    const {POST}=await import("./route");
    const response=await POST(loginRequest({email:"owner@example.test",password:"valid-password",deviceId:"44444444-4444-4444-8444-444444444444"}));
    expect(response.status).toBe(403);expect(createSession).not.toHaveBeenCalled();expect(findProfile).not.toHaveBeenCalled();
  });
  it("issues a server-owned opaque session bound to the supplied device", async () => {
    const route = await import("./route");
    const response = await route.POST(loginRequest({
      email: "owner@example.test",
      password: "valid-password",
      deviceId: "44444444-4444-4444-8444-444444444444",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(createSession).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ deviceId: "44444444-4444-4444-8444-444444444444", clientKind:"NATIVE" }),
    );
    await expect(response.json()).resolves.toEqual({
      version: "v1",
      session: { token: "s".repeat(43), expiresAt: "2026-08-25T12:00:00.000Z" },
    });
  });

  it("rejects client-supplied role data before authentication", async () => {
    const route = await import("./route");
    const response = await route.POST(loginRequest({
      email: "owner@example.test",
      password: "valid-password",
      deviceId: "44444444-4444-4444-8444-444444444444",
      role: "PLATFORM_ADMIN",
    }));

    expect(response.status).toBe(400);
    expect(findProfile).not.toHaveBeenCalled();
  });

  it("fails closed before credential lookup when Mobile is disabled", async () => {
    resolveMobileFeatureState.mockResolvedValue({ ...enabledFlags, mobileApp: false });
    const route = await import("./route");
    const response = await route.POST(loginRequest({
      email: "owner@example.test",
      password: "valid-password",
      deviceId: "44444444-4444-4444-8444-444444444444",
    }));

    expect(response.status).toBe(404);
    expect(findProfile).not.toHaveBeenCalled();
  });
});
