import "server-only";

import {
  getOAuthProviderModeForProvider,
  isLiveOAuthProviderConfigured,
  isProductionOAuthRuntime,
} from "./config";
import { oauthProviders, type OAuthProvider } from "./types";

export type LoginMethodState = {
  foundation: boolean;
  mock: boolean;
  oauthOnly: boolean;
  passwordEnabled: boolean;
  providers: Record<OAuthProvider, boolean>;
};

// Shared by public login rendering and the transactional Admin policy guard.
export function getLoginMethodAvailability(
  state: LoginMethodState,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const providers = oauthProviders.map((provider) => {
    let mode: "LIVE" | "MOCK";
    try {
      mode = getOAuthProviderModeForProvider(provider, environment);
    } catch {
      mode = "MOCK";
    }
    const configured = mode === "MOCK"
      ? !isProductionOAuthRuntime(environment)
        && Boolean(environment.OAUTH_STATE_SECRET?.trim())
      : isLiveOAuthProviderConfigured(provider, environment);
    return {
      provider,
      requested: state.foundation && state.providers[provider],
      enabled: state.foundation && state.providers[provider] && configured
        && (mode === "LIVE" || state.mock),
      configured,
    };
  });
  const legacyGoogleEnabled = !state.oauthOnly && state.foundation && state.providers.GOOGLE
    && Boolean(environment.NEXT_PUBLIC_SUPABASE_URL && environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    && !providers.some(({ provider, enabled }) => provider === "GOOGLE" && enabled);
  return {
    oauthOnly: state.oauthOnly,
    passwordEnabled: state.passwordEnabled && !state.oauthOnly,
    legacyGoogleEnabled,
    providers,
  };
}
