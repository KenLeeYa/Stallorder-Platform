import { describe, expect, it } from "vitest";
import {
  getLiveOAuthProviderConfig,
  getOAuthAppBaseUrl,
  getOAuthProviderMode,
  getOAuthProviderModeForProvider,
} from "./config";

function environment(values: Record<string, string>) {
  return {
    NODE_ENV: "test",
    APP_BASE_URL: "https://preview.example.test",
    ...values,
  } as NodeJS.ProcessEnv;
}

describe("OAuth provider configuration", () => {
  it("accepts exact Google callback configuration and minimum scopes", () => {
    const config = getLiveOAuthProviderConfig("GOOGLE", environment({
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GOOGLE_REDIRECT_URI: "https://preview.example.test/api/auth/google/callback",
    }));
    expect(config.redirectUri).toBe("https://preview.example.test/api/auth/google/callback");
    expect(config.scopes).toEqual(["openid", "profile", "email"]);
  });

  it("rejects a callback URI that does not exactly match the application URL", () => {
    expect(() => getLiveOAuthProviderConfig("GOOGLE", environment({
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GOOGLE_REDIRECT_URI: "https://attacker.example/api/auth/google/callback",
    }))).toThrow("OAUTH_GOOGLE_REDIRECT_URI_MISMATCH");
  });

  it("keeps LINE email scope disabled unless explicitly approved", () => {
    const base = {
      LINE_CHANNEL_ID: "line-channel",
      LINE_CHANNEL_SECRET: "line-secret",
      LINE_REDIRECT_URI: "https://preview.example.test/api/auth/line/callback",
    };
    expect(getLiveOAuthProviderConfig("LINE", environment(base)).scopes)
      .toEqual(["openid", "profile"]);
    expect(getLiveOAuthProviderConfig("LINE", environment({
      ...base,
      LINE_EMAIL_SCOPE_ENABLED: "true",
    })).scopes).toEqual(["openid", "profile", "email"]);
  });

  it("uses the Apple client ID when an optional service ID is blank", () => {
    const config = getLiveOAuthProviderConfig("APPLE", environment({
      APPLE_SERVICE_ID: "",
      APPLE_CLIENT_ID: "com.example.stallorder",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY123456",
      APPLE_PRIVATE_KEY: "test-private-key",
      APPLE_REDIRECT_URI: "https://preview.example.test/api/auth/apple/callback",
    }));

    expect(config.clientId).toBe("com.example.stallorder");
  });

  it("builds a fail-closed Microsoft OIDC configuration with an exact issuer", () => {
    const config = getLiveOAuthProviderConfig("MICROSOFT", environment({
      MICROSOFT_TENANT_ID: "organizations",
      MICROSOFT_CLIENT_ID: "microsoft-client",
      MICROSOFT_CLIENT_SECRET: "microsoft-secret",
      MICROSOFT_ISSUER: "https://login.microsoftonline.com/example-tenant/v2.0",
      MICROSOFT_REDIRECT_URI: "https://preview.example.test/api/auth/microsoft/callback",
    }));

    expect(config.authorizationEndpoint)
      .toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(config.issuer).toBe("https://login.microsoftonline.com/example-tenant/v2.0");
    expect(config.scopes).toEqual(["openid", "profile", "email"]);
  });

  it("rejects Microsoft without an explicitly verified issuer", () => {
    expect(() => getLiveOAuthProviderConfig("MICROSOFT", environment({
      MICROSOFT_TENANT_ID: "organizations",
      MICROSOFT_CLIENT_ID: "microsoft-client",
      MICROSOFT_CLIENT_SECRET: "microsoft-secret",
      MICROSOFT_REDIRECT_URI: "https://preview.example.test/api/auth/microsoft/callback",
    }))).toThrow("OAUTH_MICROSOFT_CONFIG_MISSING");
  });

  it("hard-rejects Mock mode in Production", () => {
    expect(() => getOAuthProviderMode({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      OAUTH_PROVIDER_MODE: "mock",
    } as NodeJS.ProcessEnv)).toThrow("OAUTH_MOCK_FORBIDDEN");
  });

  it("allows Mock mode in an explicitly isolated Vercel Preview", () => {
    expect(getOAuthProviderMode({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      OAUTH_PROVIDER_MODE: "mock",
    } as NodeJS.ProcessEnv)).toBe("MOCK");
  });

  it("uses the exact Vercel Preview deployment URL for Mock callbacks", () => {
    expect(getOAuthAppBaseUrl({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "stallorder-preview.example.vercel.app",
      APP_BASE_URL: "https://app.qidaigo.com",
    } as NodeJS.ProcessEnv)).toBe("https://stallorder-preview.example.vercel.app");
  });

  it("opts only LINE into live OAuth on an explicitly isolated Preview", () => {
    const preview = environment({
      VERCEL_ENV: "preview",
      VERCEL_URL: "stallorder-pr-123.example.vercel.app",
      OAUTH_PROVIDER_MODE: "mock",
      OAUTH_LINE_PREVIEW_LIVE: "true",
      LINE_CHANNEL_ID: "preview-line-channel",
      LINE_CHANNEL_SECRET: "preview-line-secret",
    });
    expect(getOAuthProviderModeForProvider("LINE", preview)).toBe("LIVE");
    expect(getOAuthProviderModeForProvider("GOOGLE", preview)).toBe("MOCK");
    expect(getLiveOAuthProviderConfig("LINE", preview).redirectUri)
      .toBe("https://stallorder-pr-123.example.vercel.app/api/auth/line/callback");
  });

  it("does not accept a stale Preview LINE callback or an implicit Production callback", () => {
    const preview = environment({
      VERCEL_ENV: "preview",
      VERCEL_URL: "stallorder-pr-123.example.vercel.app",
      OAUTH_PROVIDER_MODE: "mock",
      OAUTH_LINE_PREVIEW_LIVE: "true",
      LINE_CHANNEL_ID: "preview-line-channel",
      LINE_CHANNEL_SECRET: "preview-line-secret",
      LINE_REDIRECT_URI: "https://old-preview.example.vercel.app/api/auth/line/callback",
    });
    expect(() => getLiveOAuthProviderConfig("LINE", preview))
      .toThrow("OAUTH_LINE_REDIRECT_URI_MISMATCH");
    expect(() => getLiveOAuthProviderConfig("LINE", {
      ...preview,
      VERCEL_ENV: "production",
      OAUTH_PROVIDER_MODE: "live",
      LINE_REDIRECT_URI: undefined,
    } as NodeJS.ProcessEnv)).toThrow("OAUTH_LINE_REDIRECT_URI_MISSING");
    expect(() => getLiveOAuthProviderConfig("LINE", {
      ...preview,
      VERCEL_URL: undefined,
      LINE_REDIRECT_URI: undefined,
    } as NodeJS.ProcessEnv)).toThrow("OAUTH_LINE_REDIRECT_URI_MISSING");
  });
});
