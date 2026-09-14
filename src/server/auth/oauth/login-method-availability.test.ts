import { describe, expect, it } from "vitest";
import { getLoginMethodAvailability, type LoginMethodState } from "./login-method-availability";

const state: LoginMethodState = {
  foundation: true, mock: false, oauthOnly: false, passwordEnabled: false,
  providers: { GOOGLE: true, LINE: true, APPLE: false, MICROSOFT: false },
};
const environment = {
  NODE_ENV: "production", VERCEL_ENV: "production", APP_BASE_URL: "https://app.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://primary.example.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  LINE_CHANNEL_ID: "test-channel", LINE_CHANNEL_SECRET: "test-channel-secret",
  LINE_REDIRECT_URI: "https://app.example.test/api/auth/line/callback",
} as NodeJS.ProcessEnv;

describe("independent login method availability", () => {
  it("retains legacy Google and configured LINE when password sign-in is off", () => {
    const result = getLoginMethodAvailability(state, environment);
    expect(result).toMatchObject({ passwordEnabled: false, oauthOnly: false, legacyGoogleEnabled: true });
    expect(result.providers.find(({ provider }) => provider === "LINE")).toMatchObject({ configured: true, enabled: true });
  });
  it("rejects missing LINE credentials and leaves legacy Google available", () => {
    const result = getLoginMethodAvailability(state, { ...environment, LINE_CHANNEL_SECRET: undefined });
    expect(result.legacyGoogleEnabled).toBe(true);
    expect(result.providers.find(({ provider }) => provider === "LINE")).toMatchObject({ configured: false, enabled: false });
  });
  it("does not override the full migration policy or expose Production mocks", () => {
    const result = getLoginMethodAvailability({ ...state, oauthOnly: true, passwordEnabled: true, mock: true }, {
      ...environment, OAUTH_PROVIDER_MODE: "mock", OAUTH_STATE_SECRET: "test-secret",
    });
    expect(result.passwordEnabled).toBe(false);
    expect(result.legacyGoogleEnabled).toBe(false);
    expect(result.providers.every(({ enabled }) => !enabled)).toBe(true);
  });
});
