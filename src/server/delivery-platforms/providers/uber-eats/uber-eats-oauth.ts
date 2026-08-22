import { isProductionDeliveryRuntime } from "../../delivery-environment";
import { DeliveryPlatformError } from "../../delivery-platform-errors";

const UBER_EATS_ORIGINS = {
  sandbox: {
    api: "https://test-api.uber.com",
    auth: "https://sandbox-login.uber.com",
  },
  production: {
    api: "https://api.uber.com",
    auth: "https://auth.uber.com",
  },
} as const;

export type UberEatsEnvironment = keyof typeof UBER_EATS_ORIGINS;

export function getUberEatsOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
  connectionCredentialReference?: string | null,
) {
  const providerEnvironment = parseUberEnvironment(environment.UBER_EATS_ENVIRONMENT);
  if (isProductionDeliveryRuntime(environment) && providerEnvironment !== "production") {
    throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  const clientId = environment.UBER_EATS_CLIENT_ID?.trim();
  const callbackUrl = environment.UBER_EATS_CALLBACK_URL?.trim();
  const credentialReference = connectionCredentialReference?.trim()
    || environment.UBER_EATS_CREDENTIAL_REFERENCE?.trim();
  const webhookReference = environment.UBER_EATS_WEBHOOK_SECRET_REFERENCE?.trim();
  if (!clientId || !callbackUrl || !credentialReference || !webhookReference) {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }
  let callback: URL;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  if (
    !["http:", "https:"].includes(callback.protocol)
    || (providerEnvironment === "production" && callback.protocol !== "https:")
  ) {
    throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  return {
    providerEnvironment,
    apiBaseUrl: new URL(UBER_EATS_ORIGINS[providerEnvironment].api),
    authBaseUrl: new URL(UBER_EATS_ORIGINS[providerEnvironment].auth),
    clientId,
    callbackUrl: callback.toString(),
    credentialReference,
    webhookReference,
    requestTimeoutMs: boundedInteger(environment.UBER_EATS_HTTP_REQUEST_TIMEOUT_MS, 10_000, 1_000, 30_000),
    tokenRefreshSkewSeconds: boundedInteger(
      environment.UBER_EATS_TOKEN_REFRESH_SKEW_SECONDS,
      3_600,
      60,
      86_400,
    ),
  };
}

function parseUberEnvironment(value: string | undefined): UberEatsEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "sandbox" || normalized === "production") return normalized;
  throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  return parsed;
}
