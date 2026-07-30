import "server-only";

import { logEvent } from "@/lib/audit";
import {
  resolveResilienceFeatureFlags,
  type ResilienceFeatureFlagCode,
} from "@/server/resilience/feature-flag-service";
import type { OAuthProvider } from "./types";

const providerFlags: Record<OAuthProvider, ResilienceFeatureFlagCode> = {
  GOOGLE: "OAUTH_GOOGLE_ENABLED",
  LINE: "OAUTH_LINE_ENABLED",
  APPLE: "OAUTH_APPLE_ENABLED",
};

export async function resolveOAuthLoginFeatureState() {
  try {
    const flags = await resolveResilienceFeatureFlags([
      "OAUTH_IDENTITY_FOUNDATION_ENABLED",
      "OAUTH_GOOGLE_ENABLED",
      "OAUTH_LINE_ENABLED",
      "OAUTH_APPLE_ENABLED",
      "OAUTH_ONLY_LOGIN_UI_ENABLED",
      "OAUTH_MOCK_PROVIDER_ENABLED",
    ]);
    return {
      foundation: flags.OAUTH_IDENTITY_FOUNDATION_ENABLED.enabled,
      mock: flags.OAUTH_MOCK_PROVIDER_ENABLED.enabled,
      oauthOnly: flags.OAUTH_ONLY_LOGIN_UI_ENABLED.enabled,
      providers: {
        GOOGLE: flags.OAUTH_GOOGLE_ENABLED.enabled,
        LINE: flags.OAUTH_LINE_ENABLED.enabled,
        APPLE: flags.OAUTH_APPLE_ENABLED.enabled,
      } satisfies Record<OAuthProvider, boolean>,
    };
  } catch {
    logEvent("warn", "OAUTH_FEATURE_FLAG_READ_FAILED", {
      provider: null,
    });
    return {
      foundation: false,
      mock: false,
      oauthOnly: false,
      providers: {
        GOOGLE: false,
        LINE: false,
        APPLE: false,
      } satisfies Record<OAuthProvider, boolean>,
    };
  }
}

export async function resolveOAuthFeatureState(provider?: OAuthProvider) {
  const codes: ResilienceFeatureFlagCode[] = [
    "OAUTH_IDENTITY_FOUNDATION_ENABLED",
    "OAUTH_IDENTITY_LINKING_ENABLED",
    "OAUTH_MOCK_PROVIDER_ENABLED",
    ...(provider ? [providerFlags[provider]] : []),
  ];
  try {
    const flags = await resolveResilienceFeatureFlags(codes);
    return {
      foundation: flags.OAUTH_IDENTITY_FOUNDATION_ENABLED.enabled,
      linking: flags.OAUTH_IDENTITY_LINKING_ENABLED.enabled,
      mock: flags.OAUTH_MOCK_PROVIDER_ENABLED.enabled,
      provider: provider ? flags[providerFlags[provider]].enabled : false,
    };
  } catch {
    logEvent("warn", "OAUTH_FEATURE_FLAG_READ_FAILED", {
      provider: provider ?? null,
    });
    return { foundation: false, linking: false, mock: false, provider: false };
  }
}
