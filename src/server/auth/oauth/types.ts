export const oauthProviders = ["GOOGLE", "LINE", "APPLE", "MICROSOFT"] as const;

export type OAuthProvider = (typeof oauthProviders)[number];

export type OAuthIdentityClaims = {
  provider: OAuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  metadata: Record<string, string>;
};

export type OAuthAuthorizationInput = {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
};

export type OAuthExchangeInput = {
  code: string;
  codeVerifier: string;
  expectedNonce: string;
  redirectUri: string;
  firstPartyUser?: unknown;
};

export interface OAuthProviderAdapter {
  readonly provider: OAuthProvider;
  buildAuthorizationUrl(input: OAuthAuthorizationInput): Promise<URL>;
  exchangeAndVerify(input: OAuthExchangeInput): Promise<OAuthIdentityClaims>;
  verifyAccountEvent?(signedPayload: string): Promise<{
    subject: string;
    eventType: string;
    occurredAt: Date;
  }>;
}

export function parseOAuthProvider(value: string): OAuthProvider | null {
  const normalized = value.trim().toUpperCase();
  return oauthProviders.find((provider) => provider === normalized) ?? null;
}

export function oauthProviderPath(provider: OAuthProvider) {
  return provider.toLowerCase();
}
