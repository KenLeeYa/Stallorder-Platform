import "server-only";

import { z } from "zod";
import { safeEqual } from "@/lib/security";
import {
  createOAuthRandomValue,
  createPkceChallenge,
  decryptOAuthValue,
  encryptOAuthValue,
} from "./crypto";
import { isProductionOAuthRuntime } from "./config";
import type {
  OAuthAuthorizationInput,
  OAuthExchangeInput,
  OAuthIdentityClaims,
  OAuthProvider,
  OAuthProviderAdapter,
} from "./types";
import { oauthProviderPath } from "./types";
import { oauthProviders } from "./types";

const mockCodeSchema = z.object({
  provider: z.enum(oauthProviders),
  subject: z.string().min(1).max(255),
  email: z.string().email().max(320).nullable(),
  displayName: z.string().min(1).max(200),
  nonce: z.string().min(32).max(256),
  codeChallenge: z.string().min(32).max(256),
  redirectUri: z.string().url().max(2048),
  expiresAt: z.number().int().positive(),
  authorizationId: z.string().min(32).max(256),
}).strict();

type MockCodeInput = Omit<z.infer<typeof mockCodeSchema>, "authorizationId">;

export function createMockAuthorizationCode(input: MockCodeInput, secret: string) {
  if (isProductionOAuthRuntime()) throw new Error("OAUTH_MOCK_FORBIDDEN");
  return encryptOAuthValue(JSON.stringify({
    ...input,
    authorizationId: createOAuthRandomValue(),
  }), secret);
}

export class MockOidcProviderAdapter implements OAuthProviderAdapter {
  constructor(
    readonly provider: OAuthProvider,
    private readonly appBaseUrl: string,
    private readonly stateSecret: string,
  ) {
    if (isProductionOAuthRuntime()) throw new Error("OAUTH_MOCK_FORBIDDEN");
  }

  async buildAuthorizationUrl(input: OAuthAuthorizationInput) {
    const callback = `${this.appBaseUrl}/api/auth/${oauthProviderPath(this.provider)}/callback`;
    if (input.redirectUri !== callback) throw new Error("OAUTH_REDIRECT_URI_MISMATCH");
    const url = new URL("/api/auth/mock/authorize", this.appBaseUrl);
    url.searchParams.set("provider", this.provider);
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("redirect_uri", input.redirectUri);
    return url;
  }

  async exchangeAndVerify(input: OAuthExchangeInput): Promise<OAuthIdentityClaims> {
    let parsed: z.infer<typeof mockCodeSchema>;
    try {
      parsed = mockCodeSchema.parse(
        JSON.parse(decryptOAuthValue(input.code, this.stateSecret)),
      );
    } catch {
      throw new Error("OAUTH_MOCK_CODE_INVALID");
    }
    if (
      parsed.provider !== this.provider
      || parsed.expiresAt <= Date.now()
      || parsed.redirectUri !== input.redirectUri
      || !safeEqual(parsed.nonce, input.expectedNonce)
      || !safeEqual(parsed.codeChallenge, createPkceChallenge(input.codeVerifier))
    ) {
      throw new Error("OAUTH_MOCK_CODE_INVALID");
    }
    return {
      provider: this.provider,
      subject: parsed.subject,
      email: parsed.email?.trim().toLowerCase() ?? null,
      emailVerified: Boolean(parsed.email),
      displayName: parsed.displayName,
      avatarUrl: null,
      metadata: { synthetic: "true" },
    };
  }
}
