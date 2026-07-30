import { DeliveryPlatformError } from "../../delivery-platform-errors";

export function getUberEatsOAuthConfig(environment: NodeJS.ProcessEnv = process.env) {
  const clientId = environment.UBER_EATS_CLIENT_ID?.trim();
  const callbackUrl = environment.UBER_EATS_CALLBACK_URL?.trim();
  const credentialReference = environment.UBER_EATS_CREDENTIAL_REFERENCE?.trim();
  if (!clientId || !callbackUrl || !credentialReference) {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }
  const callback = new URL(callbackUrl);
  if (environment.NODE_ENV === "production" && callback.protocol !== "https:") {
    throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  return { clientId, callbackUrl: callback.toString(), credentialReference };
}
