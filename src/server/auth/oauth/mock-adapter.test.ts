import { describe, expect, it } from "vitest";
import { createPkceChallenge } from "./crypto";
import {
  createMockAuthorizationCode,
  MockOidcProviderAdapter,
} from "./mock-adapter";

const secret = "test-only-oauth-state-secret-with-more-than-32-characters";
const appBaseUrl = "https://preview.example.test";
const redirectUri = `${appBaseUrl}/api/auth/line/callback`;

function code(values: Partial<Parameters<typeof createMockAuthorizationCode>[0]> = {}) {
  const codeVerifier = "v".repeat(64);
  return {
    codeVerifier,
    authorizationCode: createMockAuthorizationCode({
      provider: "LINE",
      subject: "synthetic-line-subject",
      email: null,
      displayName: "LINE Preview 使用者",
      nonce: "n".repeat(48),
      codeChallenge: createPkceChallenge(codeVerifier),
      redirectUri,
      expiresAt: Date.now() + 60_000,
      ...values,
    }, secret),
  };
}

describe("Mock OIDC provider", () => {
  it("returns only normalized synthetic identity claims", async () => {
    const adapter = new MockOidcProviderAdapter("LINE", appBaseUrl, secret);
    const fixture = code();
    await expect(adapter.exchangeAndVerify({
      code: fixture.authorizationCode,
      codeVerifier: fixture.codeVerifier,
      expectedNonce: "n".repeat(48),
      redirectUri,
    })).resolves.toEqual({
      provider: "LINE",
      subject: "synthetic-line-subject",
      email: null,
      emailVerified: false,
      displayName: "LINE Preview 使用者",
      avatarUrl: null,
      metadata: { synthetic: "true" },
    });
  });

  it("rejects wrong PKCE verifier, nonce and expired codes", async () => {
    const adapter = new MockOidcProviderAdapter("LINE", appBaseUrl, secret);
    const fixture = code();
    await expect(adapter.exchangeAndVerify({
      code: fixture.authorizationCode,
      codeVerifier: "wrong".repeat(20),
      expectedNonce: "n".repeat(48),
      redirectUri,
    })).rejects.toThrow("OAUTH_MOCK_CODE_INVALID");

    await expect(adapter.exchangeAndVerify({
      code: fixture.authorizationCode,
      codeVerifier: fixture.codeVerifier,
      expectedNonce: "x".repeat(48),
      redirectUri,
    })).rejects.toThrow("OAUTH_MOCK_CODE_INVALID");

    const expired = code({ expiresAt: Date.now() - 1 });
    await expect(adapter.exchangeAndVerify({
      code: expired.authorizationCode,
      codeVerifier: expired.codeVerifier,
      expectedNonce: "n".repeat(48),
      redirectUri,
    })).rejects.toThrow("OAUTH_MOCK_CODE_INVALID");
  });
});
