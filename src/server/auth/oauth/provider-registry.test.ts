import { describe, expect, it, vi } from "vitest";

vi.mock("./feature-flags", () => ({
  resolveOAuthFeatureState: async () => ({ foundation: true, provider: true, mock: true }),
  resolveOAuthLoginFeatureState: async () => ({
    foundation: true,
    mock: true,
    oauthOnly: false,
    passwordEnabled: true,
    providers: { GOOGLE: true, LINE: true, APPLE: false, MICROSOFT: false },
  }),
}));

import {
  getOAuthLoginUiConfig,
  getOAuthProviderAvailability,
  getOAuthRedirectUri,
} from "./provider-registry";

describe("isolated Preview LINE Login", () => {
  const environment = {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    VERCEL_URL: "stallorder-pr-123.example.vercel.app",
    APP_BASE_URL: "https://app.qidaigo.com",
    OAUTH_PROVIDER_MODE: "mock",
    OAUTH_LINE_PREVIEW_LIVE: "true",
    OAUTH_STATE_SECRET: "preview-state-secret-at-least-thirty-two-bytes",
    LINE_CHANNEL_ID: "preview-line-channel",
    LINE_CHANNEL_SECRET: "preview-line-secret",
  } as NodeJS.ProcessEnv;

  it("uses live LINE without changing the synthetic Google provider", async () => {
    expect(await getOAuthProviderAvailability("LINE", environment))
      .toEqual({ enabled: true, configured: true, mode: "LIVE" });
    expect(await getOAuthProviderAvailability("GOOGLE", environment))
      .toEqual({ enabled: true, configured: true, mode: "MOCK" });
    expect(getOAuthRedirectUri("LINE", environment))
      .toBe("https://stallorder-pr-123.example.vercel.app/api/auth/line/callback");

    const ui = await getOAuthLoginUiConfig(environment);
    expect(ui.providers.find(({ provider }) => provider === "LINE"))
      .toMatchObject({ enabled: true, configured: true });
  });

  it("does not make the Preview-only override available in Production", async () => {
    expect(await getOAuthProviderAvailability("LINE", {
      ...environment,
      VERCEL_ENV: "production",
    } as NodeJS.ProcessEnv)).toEqual({ enabled: false, configured: false, mode: "MOCK" });
  });
});
