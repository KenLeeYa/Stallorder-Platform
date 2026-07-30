import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { LiveOAuthProviderConfig } from "./config";
import { OidcProviderAdapter } from "./oidc-adapter";

const config: LiveOAuthProviderConfig = {
  provider: "GOOGLE",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://preview.example.test/api/auth/google/callback",
  authorizationEndpoint: "https://issuer.example/authorize",
  tokenEndpoint: "https://issuer.example/token",
  issuer: "https://issuer.example",
  jwksUri: "https://issuer.example/jwks",
  scopes: ["openid", "profile", "email"],
};

let privateKey: CryptoKey;
let keyResolver: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKey = keys.privateKey;
  const publicJwk = await exportJWK(keys.publicKey);
  keyResolver = createLocalJWKSet({
    keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }],
  });
});

async function idToken(values: {
  issuer?: string;
  audience?: string;
  nonce?: string;
  algorithm?: "RS256" | "none";
} = {}) {
  if (values.algorithm === "none") {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: config.issuer,
      aud: config.clientId,
      sub: "google-subject",
      nonce: "expected-nonce",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    })).toString("base64url");
    return `${header}.${payload}.`;
  }
  return new SignJWT({
    nonce: values.nonce ?? "expected-nonce",
    email: "verified@example.test",
    email_verified: true,
    name: "Verified User",
    locale: "zh-TW",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(values.issuer ?? config.issuer as string)
    .setAudience(values.audience ?? config.clientId)
    .setSubject("google-subject")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}

function adapterFor(token: string) {
  const fetchImpl = (async () => new Response(JSON.stringify({ id_token: token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  return new OidcProviderAdapter(config, fetchImpl, keyResolver);
}

describe("OIDC provider adapter", () => {
  it("builds Authorization Code + PKCE with minimum scopes", async () => {
    const url = await adapterFor(await idToken()).buildAuthorizationUrl({
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
      redirectUri: config.redirectUri,
    });
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("verifies signature and required claims before normalizing identity", async () => {
    const adapter = adapterFor(await idToken());
    await expect(adapter.exchangeAndVerify({
      code: "one-time-code",
      codeVerifier: "verifier",
      expectedNonce: "expected-nonce",
      redirectUri: config.redirectUri,
    })).resolves.toMatchObject({
      provider: "GOOGLE",
      subject: "google-subject",
      email: "verified@example.test",
      emailVerified: true,
      displayName: "Verified User",
      metadata: { locale: "zh-TW" },
    });
  });

  it("rejects wrong nonce, issuer, audience and unsigned tokens", async () => {
    const inputs = {
      code: "one-time-code",
      codeVerifier: "verifier",
      expectedNonce: "expected-nonce",
      redirectUri: config.redirectUri,
    };
    await expect(adapterFor(await idToken({ nonce: "wrong" })).exchangeAndVerify(inputs))
      .rejects.toThrow("OAUTH_ID_TOKEN_INVALID");
    await expect(adapterFor(await idToken({ issuer: "https://wrong.example" })).exchangeAndVerify(inputs))
      .rejects.toThrow();
    await expect(adapterFor(await idToken({ audience: "wrong-client" })).exchangeAndVerify(inputs))
      .rejects.toThrow();
    await expect(adapterFor(await idToken({ algorithm: "none" })).exchangeAndVerify(inputs))
      .rejects.toThrow();
  });
});
