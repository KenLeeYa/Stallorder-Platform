import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), count: vi.fn(), lock: vi.fn(), write: vi.fn(), audit: vi.fn(), readiness: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/server/auth/oauth/migration-readiness", () => ({ getOAuthMigrationReadiness: mocks.readiness }));
vi.mock("@/lib/prisma", () => {
  const transaction = {
    $executeRaw: mocks.lock,
    resilienceFeatureFlag: { findMany: mocks.findMany, upsert: mocks.upsert },
    profile: { count: mocks.count },
    resilienceFeatureFlagOverride: { findFirst: vi.fn(async () => null), create: mocks.write },
    auditLog: { create: mocks.audit },
  };
  return { prisma: {
    resilienceFeatureFlag: { findUnique: mocks.findUnique },
    $transaction: async (operation: (tx: typeof transaction) => unknown) => operation(transaction),
  } };
});

import { setResilienceFeatureFlagOverride, type ResilienceFlagOverrideCommand } from "./feature-flag-service";

const command: ResilienceFlagOverrideCommand = {
  scopeType: "GLOBAL", organizationId: null, stallId: null, deviceId: null,
  enabled: false, rolloutPercentage: null, expiresAt: null, reason: "Test method policy",
};
const actor = { profileId: "admin-id", requestId: "request-id", ipHash: "test-hash" };
function records(overrides: Record<string, boolean> = {}) {
  return Object.entries({
    AUTH_PASSWORD_LOGIN_ENABLED: true, OAUTH_ONLY_LOGIN_UI_ENABLED: false,
    OAUTH_IDENTITY_FOUNDATION_ENABLED: true, OAUTH_MOCK_PROVIDER_ENABLED: false,
    OAUTH_GOOGLE_ENABLED: true, OAUTH_LINE_ENABLED: false, OAUTH_APPLE_ENABLED: false, OAUTH_MICROSOFT_ENABLED: false,
    ...overrides,
  }).map(([code, defaultEnabled]) => ({ id: code, code, defaultEnabled, overrides: [] }));
}

describe("transactional Admin login method guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("OAUTH_PROVIDER_MODE", "live");
    vi.stubEnv("APP_BASE_URL", "https://app.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://primary.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.stubEnv("AUTH_PROJECT_CODE", "PRIMARY");
    for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "LINE_CHANNEL_ID", "LINE_CHANNEL_SECRET"]) vi.stubEnv(name, "");
    mocks.findMany.mockResolvedValue(records());
    mocks.findUnique.mockImplementation(async ({ where }) => ({ id: "flag-id", code: where.code, isEmergency: false }));
    mocks.upsert.mockResolvedValue({ id: "new-password-flag", isEmergency: false });
    mocks.count.mockResolvedValue(1);
    mocks.readiness.mockResolvedValue({ readyForOAuthOnly: false });
    mocks.write.mockImplementation(async ({ data }) => ({ ...data, id: "override-id", createdAt: new Date(), updatedAt: new Date() }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("disables passwords without migrating Google identities or modifying profiles", async () => {
    await setResilienceFeatureFlagOverride("AUTH_PASSWORD_LOGIN_ENABLED", command, actor);
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.count).toHaveBeenCalledWith({ where: { id: "admin-id", isActive: true, OR: [
      { authProjectIdentities: { some: { authProjectCode: "PRIMARY", provider: "GOOGLE" } } },
    ] } });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.findMany.mock.invocationCallOrder[0]);
    expect(mocks.findMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.write.mock.invocationCallOrder[0]);
    expect(mocks.audit.mock.calls[0][0].data.metadata).toContain("AUTH_PASSWORD_LOGIN_ENABLED");
  });
  it("reads current flags after the shared lock and refuses the last provider removal", async () => {
    mocks.findMany.mockResolvedValue(records({ AUTH_PASSWORD_LOGIN_ENABLED: false }));
    await expect(setResilienceFeatureFlagOverride("OAUTH_GOOGLE_ENABLED", command, actor))
      .rejects.toThrow("AUTH_METHOD_LAST_AVAILABLE_REQUIRED");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("materializes only the password catalog entry after authorization in the audited transaction", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await setResilienceFeatureFlagOverride("AUTH_PASSWORD_LOGIN_ENABLED", command, actor);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "AUTH_PASSWORD_LOGIN_ENABLED" }, update: {} }));
    expect(mocks.count.mock.invocationCallOrder[0]).toBeLessThan(mocks.upsert.mock.invocationCallOrder[0]);
    expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]);
    expect(mocks.write.mock.calls[0][0].data.flagId).toBe("new-password-flag");
  });
  it("does not create a flag when the change would lock out the administrator", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.count.mockResolvedValue(0);
    await expect(setResilienceFeatureFlagOverride("AUTH_PASSWORD_LOGIN_ENABLED", command, actor))
      .rejects.toThrow("AUTH_METHOD_ADMIN_ACCESS_REQUIRED");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("does not rely on a provider whose enabling override will expire", async () => {
    const flags = records({ OAUTH_GOOGLE_ENABLED: false });
    const google = flags.find(({ code }) => code === "OAUTH_GOOGLE_ENABLED")!;
    Object.assign(google, { overrides: [{ scopeType: "GLOBAL", enabled: true, expiresAt: new Date(Date.now() + 60_000) }] });
    mocks.findMany.mockResolvedValue(flags);
    await expect(setResilienceFeatureFlagOverride("AUTH_PASSWORD_LOGIN_ENABLED", command, actor))
      .rejects.toThrow("AUTH_METHOD_LAST_AVAILABLE_REQUIRED");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("requires the actor's verified login identity, not just a globally enabled provider", async () => {
    mocks.count.mockResolvedValue(0);
    await expect(setResilienceFeatureFlagOverride("AUTH_PASSWORD_LOGIN_ENABLED", command, actor))
      .rejects.toThrow("AUTH_METHOD_ADMIN_ACCESS_REQUIRED");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not count a provider that is currently disabled by a temporary override", async () => {
    const flags = records();
    const google = flags.find(({ code }) => code === "OAUTH_GOOGLE_ENABLED")!;
    Object.assign(google, { overrides: [{ scopeType: "GLOBAL", enabled: false, expiresAt: new Date(Date.now() + 60_000) }] });
    mocks.findMany.mockResolvedValue(flags);
    await expect(setResilienceFeatureFlagOverride("AUTH_PASSWORD_LOGIN_ENABLED", command, actor))
      .rejects.toThrow("AUTH_METHOD_LAST_AVAILABLE_REQUIRED");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("refuses to enable LINE without runtime credentials", async () => {
    await expect(setResilienceFeatureFlagOverride("OAUTH_LINE_ENABLED", { ...command, enabled: true }, actor))
      .rejects.toThrow("AUTH_METHOD_PROVIDER_NOT_CONFIGURED");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("enables configured LINE without requiring full identity migration", async () => {
    vi.stubEnv("LINE_CHANNEL_ID", "test-channel");
    vi.stubEnv("LINE_CHANNEL_SECRET", "test-secret");
    vi.stubEnv("LINE_REDIRECT_URI", "https://app.example.test/api/auth/line/callback");
    await setResilienceFeatureFlagOverride("OAUTH_LINE_ENABLED", { ...command, enabled: true }, actor);
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it("keeps the independent full OAuth migration gate intact", async () => {
    await expect(setResilienceFeatureFlagOverride("OAUTH_ONLY_LOGIN_UI_ENABLED", { ...command, enabled: true }, actor))
      .rejects.toThrow("OAUTH_MIGRATION_GATE_BLOCKED");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("cannot restore passwords while the full OAuth-only contract remains active", async () => {
    mocks.findMany.mockResolvedValue(records({ OAUTH_ONLY_LOGIN_UI_ENABLED: true }));
    await expect(setResilienceFeatureFlagOverride("AUTH_PASSWORD_LOGIN_ENABLED", { ...command, enabled: true }, actor))
      .rejects.toThrow("AUTH_PASSWORD_LOGIN_CONTRACTED");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each([
    { ...command, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    { ...command, scopeType: "PERCENTAGE" as const, rolloutPercentage: 50 },
  ])("rejects temporary or scoped login policy changes", async (invalid) => {
    await expect(setResilienceFeatureFlagOverride("AUTH_PASSWORD_LOGIN_ENABLED", invalid, actor))
      .rejects.toThrow("AUTH_METHOD_GLOBAL_PERMANENT_REQUIRED");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
