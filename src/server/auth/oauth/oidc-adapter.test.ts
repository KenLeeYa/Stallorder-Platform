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

describe("LINE web ID token verification", () => {
  const lineConfig: LiveOAuthProviderConfig = {
    ...config,
    provider: "LINE",
    clientId: "line-web-test-channel",
    clientSecret: "line-web-channel-secret-fixture-only",
    issuer: "https://access.line.me",
    redirectUri: "https://preview.example.test/api/auth/line/callback",
    scopes: ["openid", "profile"],
  };
  const inputs = {
    code: "line-one-time-code",
    codeVerifier: "line-pkce-verifier",
    expectedNonce: "expected-nonce",
    redirectUri: lineConfig.redirectUri,
  };

  async function lineIdToken(values: {
    secret?: string;
    nonce?: string;
    issuer?: string;
    audience?: string;
    expired?: boolean;
    algorithm?: "HS256" | "RS256";
  } = {}) {
    const algorithm = values.algorithm ?? "HS256";
    return new SignJWT({ nonce: values.nonce ?? inputs.expectedNonce, name: "LINE Test User" })
      .setProtectedHeader({ alg: algorithm, ...(algorithm === "RS256" ? { kid: "test-key" } : {}) })
      .setIssuer(values.issuer ?? lineConfig.issuer as string)
      .setAudience(values.audience ?? lineConfig.clientId)
      .setSubject("line-test-subject")
      .setIssuedAt()
      .setExpirationTime(values.expired ? Math.floor(Date.now() / 1000) - 60 : "5 minutes")
      .sign(algorithm === "RS256" ? privateKey : new TextEncoder().encode(values.secret ?? lineConfig.clientSecret));
  }

  function lineAdapterFor(token: string) {
    const fetchImpl = (async () => new Response(JSON.stringify({ id_token: token }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
    return new OidcProviderAdapter(lineConfig, fetchImpl, keyResolver);
  }

  it("verifies a web HS256 token using the LINE Channel Secret without JWKS", async () => {
    await expect(lineAdapterFor(await lineIdToken()).exchangeAndVerify(inputs)).resolves.toMatchObject({
      provider: "LINE",
      subject: "line-test-subject",
      displayName: "LINE Test User",
      email: null,
      emailVerified: false,
    });
  });

  it.each([
    { secret: "wrong-line-web-secret-fixture-only" },
    { nonce: "wrong-nonce" },
    { issuer: "https://wrong.example" },
    { audience: "another-channel" },
    { expired: true },
    { algorithm: "RS256" as const },
  ])("rejects invalid LINE token properties: %j", async (values) => {
    await expect(lineAdapterFor(await lineIdToken(values)).exchangeAndVerify(inputs)).rejects.toThrow();
  });

  it("rejects unsigned LINE tokens", async () => {
    const token = await lineIdToken();
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    await expect(lineAdapterFor(`${header}.${token.split(".")[1]}.`).exchangeAndVerify(inputs)).rejects.toThrow();
  });

  it("does not permit HS256 tokens for other OIDC providers", async () => {
    await expect(adapterFor(await lineIdToken({
      secret: config.clientSecret,
      issuer: config.issuer as string,
      audience: config.clientId,
    })).exchangeAndVerify({ ...inputs, redirectUri: config.redirectUri })).rejects.toThrow();
  });
});
