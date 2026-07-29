import "server-only";

import type { OAuthProvider } from "./types";
import { oauthProviderPath } from "./types";

export type OAuthProviderMode = "LIVE" | "MOCK";

export type LiveOAuthProviderConfig = {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  issuer: string | string[];
  jwksUri: string;
  scopes: string[];
  apple?: {
    teamId: string;
    keyId: string;
    privateKey: string;
  };
};

function required(value: string | undefined, errorCode: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function validAbsoluteUrl(value: string, errorCode: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(errorCode);
    }
    return url.toString();
  } catch {
    throw new Error(errorCode);
  }
}

export function getOAuthProviderMode(
  environment: NodeJS.ProcessEnv = process.env,
): OAuthProviderMode {
  if (environment.OAUTH_PROVIDER_MODE?.trim().toLowerCase() !== "mock") return "LIVE";
  if (isProductionOAuthRuntime(environment)) throw new Error("OAUTH_MOCK_FORBIDDEN");
  return "MOCK";
}

export function isProductionOAuthRuntime(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (environment.VERCEL_ENV === "preview" || environment.VERCEL_ENV === "development") {
    return false;
  }
  return environment.VERCEL_ENV === "production"
    || environment.NODE_ENV === "production";
}

export function getOAuthAppBaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const previewDeploymentUrl = environment.VERCEL_ENV === "preview"
    && environment.VERCEL_URL
    ? `https://${environment.VERCEL_URL}`
    : undefined;
  return validAbsoluteUrl(
    required(
      previewDeploymentUrl
      ?? environment.APP_BASE_URL
      ?? environment.NEXT_PUBLIC_APP_URL,
      "OAUTH_APP_BASE_URL_MISSING",
    ),
    "OAUTH_APP_BASE_URL_INVALID",
  ).replace(/\/$/, "");
}

function redirectUri(
  provider: OAuthProvider,
  configured: string | undefined,
  environment: NodeJS.ProcessEnv,
) {
  const expected = `${getOAuthAppBaseUrl(environment)}/api/auth/${oauthProviderPath(provider)}/callback`;
  const actual = validAbsoluteUrl(
    required(configured, `OAUTH_${provider}_REDIRECT_URI_MISSING`),
    `OAUTH_${provider}_REDIRECT_URI_INVALID`,
  ).replace(/\/$/, "");
  if (actual !== expected) throw new Error(`OAUTH_${provider}_REDIRECT_URI_MISMATCH`);
  return actual;
}

export function getLiveOAuthProviderConfig(
  provider: OAuthProvider,
  environment: NodeJS.ProcessEnv = process.env,
): LiveOAuthProviderConfig {
  if (provider === "GOOGLE") {
    return {
      provider,
      clientId: required(environment.GOOGLE_CLIENT_ID, "OAUTH_GOOGLE_CONFIG_MISSING"),
      clientSecret: required(environment.GOOGLE_CLIENT_SECRET, "OAUTH_GOOGLE_CONFIG_MISSING"),
      redirectUri: redirectUri(provider, environment.GOOGLE_REDIRECT_URI, environment),
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      scopes: ["openid", "profile", "email"],
    };
  }

  if (provider === "LINE") {
    return {
      provider,
      clientId: required(environment.LINE_CHANNEL_ID, "OAUTH_LINE_CONFIG_MISSING"),
      clientSecret: required(environment.LINE_CHANNEL_SECRET, "OAUTH_LINE_CONFIG_MISSING"),
      redirectUri: redirectUri(provider, environment.LINE_REDIRECT_URI, environment),
      authorizationEndpoint: "https://access.line.me/oauth2/v2.1/authorize",
      tokenEndpoint: "https://api.line.me/oauth2/v2.1/token",
      issuer: "https://access.line.me",
      jwksUri: "https://api.line.me/oauth2/v2.1/certs",
      scopes: environment.LINE_EMAIL_SCOPE_ENABLED === "true"
        ? ["openid", "profile", "email"]
        : ["openid", "profile"],
    };
  }

  const clientId = required(
    environment.APPLE_SERVICE_ID || environment.APPLE_CLIENT_ID,
    "OAUTH_APPLE_CONFIG_MISSING",
  );
  return {
    provider,
    clientId,
    clientSecret: "",
    redirectUri: redirectUri(provider, environment.APPLE_REDIRECT_URI, environment),
    authorizationEndpoint: "https://appleid.apple.com/auth/authorize",
    tokenEndpoint: "https://appleid.apple.com/auth/token",
    issuer: "https://appleid.apple.com",
    jwksUri: "https://appleid.apple.com/auth/keys",
    scopes: ["name", "email"],
    apple: {
      teamId: required(environment.APPLE_TEAM_ID, "OAUTH_APPLE_CONFIG_MISSING"),
      keyId: required(environment.APPLE_KEY_ID, "OAUTH_APPLE_CONFIG_MISSING"),
      privateKey: required(environment.APPLE_PRIVATE_KEY, "OAUTH_APPLE_CONFIG_MISSING")
        .replace(/\\n/g, "\n"),
    },
  };
}

export function isLiveOAuthProviderConfigured(
  provider: OAuthProvider,
  environment: NodeJS.ProcessEnv = process.env,
) {
  try {
    getLiveOAuthProviderConfig(provider, environment);
    return true;
  } catch {
    return false;
  }
}
