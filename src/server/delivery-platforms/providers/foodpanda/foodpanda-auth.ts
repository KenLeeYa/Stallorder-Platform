import { isProductionDeliveryRuntime } from "../../delivery-environment";
import { DeliveryPlatformError } from "../../delivery-platform-errors";

const FOODPANDA_BASE_URLS = {
  sandbox: "https://sandbox.partner.deliveryhero.io",
  production: "https://foodpanda.partner.deliveryhero.io",
} as const;

export type FoodpandaEnvironment = keyof typeof FOODPANDA_BASE_URLS;

export function getFoodpandaPartnerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  connectionCredentialReference?: string | null,
) {
  const providerEnvironment = parseFoodpandaEnvironment(environment.FOODPANDA_ENVIRONMENT);
  if (isProductionDeliveryRuntime(environment) && providerEnvironment !== "production") {
    throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  const clientId = environment.FOODPANDA_CLIENT_ID?.trim();
  const credentialReference = connectionCredentialReference?.trim()
    || environment.FOODPANDA_CREDENTIAL_REFERENCE?.trim();
  const webhookReference = environment.FOODPANDA_WEBHOOK_CREDENTIAL_REFERENCE?.trim();
  const currency = (environment.FOODPANDA_CURRENCY?.trim() || "TWD").toUpperCase();
  if (!clientId || !credentialReference || !webhookReference || !/^[A-Z]{3}$/.test(currency)) {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }
  return {
    providerEnvironment,
    baseUrl: new URL(FOODPANDA_BASE_URLS[providerEnvironment]),
    clientId,
    credentialReference,
    webhookReference,
    currency,
    requestTimeoutMs: boundedInteger(environment.FOODPANDA_HTTP_REQUEST_TIMEOUT_MS, 10_000, 1_000, 30_000),
    tokenRefreshSkewSeconds: boundedInteger(
      environment.FOODPANDA_TOKEN_REFRESH_SKEW_SECONDS,
      300,
      30,
      1_800,
    ),
  };
}

function parseFoodpandaEnvironment(value: string | undefined): FoodpandaEnvironment {
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
