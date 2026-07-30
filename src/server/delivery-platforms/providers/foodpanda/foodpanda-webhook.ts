import { DeliveryPlatformError } from "../../delivery-platform-errors";

export function assertFoodpandaWebhookConfigured(environment: NodeJS.ProcessEnv = process.env) {
  if (!environment.FOODPANDA_WEBHOOK_CREDENTIAL_REFERENCE?.trim()) {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }
}
