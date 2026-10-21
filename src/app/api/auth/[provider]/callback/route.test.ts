import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adapter: vi.fn(), claim: vi.fn(), failed: vi.fn(), complete: vi.fn(), audit: vi.fn(),
  principal: vi.fn(), exchange: vi.fn(), cookies: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getRequestPrincipal: mocks.principal, setSessionCookies: mocks.cookies }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/device-label", () => ({ getRequestDeviceLabel: () => "test-device" }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/security", () => ({
  createRequestId: () => "callback-test", hashClientIp: () => "ip-hash",
  hashClientUserAgent: () => "ua-hash", resolveSessionDeviceId: () => "device-id",
  sanitizeRedirectPath: (value: string) => value,
}));
vi.mock("@/lib/workspace", () => ({ getWorkspaceAccess: vi.fn().mockResolvedValue([]), getDefaultWorkspacePath: () => "/staff" }));
vi.mock("@/server/auth/oauth/config", () => ({ getOAuthAppBaseUrl: () => "https://app.example.test" }));
vi.mock("@/server/auth/oauth/provider-registry", () => ({ getEnabledOAuthProviderAdapter: mocks.adapter }));
vi.mock("@/server/auth/oauth/transaction-service", () => ({ claimOAuthTransaction: mocks.claim, markOAuthTransactionFailed: mocks.failed }));
vi.mock("@/server/auth/oauth/identity-service", () => ({ completeOAuthLogin: mocks.complete }));
vi.mock("@/server/merchant-applications/merchant-setup-service", () => ({ getPendingMerchantSetupPath: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adapter.mockResolvedValue({ exchangeAndVerify: mocks.exchange });
  mocks.claim.mockResolvedValue({ status: "CLAIMED", id: "transaction-id", nonce: "nonce", codeVerifier: "verifier", redirectUri: "https://app.example.test/callback", currentProfileId: null });
});

describe("OAuth callback provider activation boundary", () => {
  it.each(["google", "line", "apple", "microsoft"])("rejects disabled %s before claiming or decrypting its transaction", async provider => {
    mocks.adapter.mockRejectedValue(new Error("OAUTH_PROVIDER_DISABLED"));
    const response = await GET(new Request(`https://app.example.test/api/auth/${provider}/callback?state=${"s".repeat(43)}&code=test-code`), { params: Promise.resolve({ provider }) });
    expect(response.headers.get("location")).toBe("https://app.example.test/login?oauthError=callback-failed");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.failed).not.toHaveBeenCalled();
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { provider: provider.toUpperCase(), reason: "OAUTH_PROVIDER_DISABLED" } }));
  });

  it("also rejects disabled Apple form-post without consuming the transaction", async () => {
    mocks.adapter.mockRejectedValue(new Error("OAUTH_PROVIDER_DISABLED"));
    const response = await POST(new Request("https://app.example.test/api/auth/apple/callback", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ state: "s".repeat(43), code: "test-code" }) }), { params: Promise.resolve({ provider: "apple" }) });
    expect(response.status).toBe(307);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.failed).not.toHaveBeenCalled();
  });

  it("still claims enabled transactions and records an exchange failure", async () => {
    mocks.exchange.mockRejectedValue(new Error("OAUTH_TOKEN_EXCHANGE_FAILED"));
    await GET(new Request(`https://app.example.test/api/auth/google/callback?state=${"s".repeat(43)}&code=test-code`), { params: Promise.resolve({ provider: "google" }) });
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.adapter.mock.invocationCallOrder[0]).toBeLessThan(mocks.claim.mock.invocationCallOrder[0]);
    expect(mocks.exchange).toHaveBeenCalledOnce();
    expect(mocks.failed).toHaveBeenCalledWith("transaction-id");
  });

  it("preserves completed callback retries for the matching enabled session", async () => {
    mocks.claim.mockResolvedValue({ status: "COMPLETED", id: "transaction-id", resultSessionId: "session-id", returnTo: "/staff" });
    mocks.principal.mockResolvedValue({ sessionId: "session-id" });
    const response = await GET(new Request(`https://app.example.test/api/auth/google/callback?state=${"s".repeat(43)}&code=test-code`), { params: Promise.resolve({ provider: "google" }) });
    expect(response.headers.get("location")).toBe("https://app.example.test/staff");
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.failed).not.toHaveBeenCalled();
  });
});
