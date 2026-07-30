import "server-only";

import {
  getLiveOAuthProviderConfig,
  getOAuthAppBaseUrl,
  getOAuthProviderMode,
  isProductionOAuthRuntime,
  isLiveOAuthProviderConfigured,
} from "./config";
import { requireOAuthStateSecret } from "./crypto";
import {
  resolveOAuthFeatureState,
  resolveOAuthLoginFeatureState,
} from "./feature-flags";
import { MockOidcProviderAdapter } from "./mock-adapter";
import { OidcProviderAdapter } from "./oidc-adapter";
import {
  oauthProviders,
  type OAuthProvider,
  type OAuthProviderAdapter,
} from "./types";

export function createOAuthProviderAdapter(
  provider: OAuthProvider,
  environment: NodeJS.ProcessEnv = process.env,
): OAuthProviderAdapter {
  if (getOAuthProviderMode(environment) === "MOCK") {
    return new MockOidcProviderAdapter(
      provider,
      getOAuthAppBaseUrl(environment),
      requireOAuthStateSecret(environment),
    );
  }
  return new OidcProviderAdapter(getLiveOAuthProviderConfig(provider, environment));
}

export async function getOAuthProviderAvailability(
  provider: OAuthProvider,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const state = await resolveOAuthFeatureState(provider);
  let mode: "LIVE" | "MOCK";
  try {
    mode = getOAuthProviderMode(environment);
  } catch {
    return { enabled: false, configured: false, mode: "MOCK" as const };
  }
  const configured = mode === "MOCK"
    ? !isProductionOAuthRuntime(environment)
      && Boolean(environment.OAUTH_STATE_SECRET?.trim())
    : isLiveOAuthProviderConfigured(provider, environment);
  const enabled = state.foundation
    && state.provider
    && configured
    && (mode === "LIVE" || state.mock);
  return { enabled, configured, mode };
}

export async function getOAuthLoginUiConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const state = await resolveOAuthLoginFeatureState();
  let mode: "LIVE" | "MOCK";
  try {
    mode = getOAuthProviderMode(environment);
  } catch {
    mode = "MOCK";
  }
  const providers = oauthProviders.map((provider) => {
    const configured = mode === "MOCK"
      ? !isProductionOAuthRuntime(environment)
        && Boolean(environment.OAUTH_STATE_SECRET?.trim())
      : isLiveOAuthProviderConfigured(provider, environment);
    return {
      provider,
      enabled: state.foundation
        && state.providers[provider]
        && configured
        && (mode === "LIVE" || state.mock),
      configured,
    };
  });
  return {
    oauthOnly: state.oauthOnly,
    providers,
  };
}

export async function getEnabledOAuthProviderAdapter(
  provider: OAuthProvider,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const availability = await getOAuthProviderAvailability(provider, environment);
  if (!availability.enabled) throw new Error("OAUTH_PROVIDER_DISABLED");
  return createOAuthProviderAdapter(provider, environment);
}

export function getOAuthRedirectUri(
  provider: OAuthProvider,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return getOAuthProviderMode(environment) === "MOCK"
    ? `${getOAuthAppBaseUrl(environment)}/api/auth/${provider.toLowerCase()}/callback`
    : getLiveOAuthProviderConfig(provider, environment).redirectUri;
}
