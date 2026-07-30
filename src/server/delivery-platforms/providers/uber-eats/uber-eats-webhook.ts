import { DeliveryPlatformError } from "../../delivery-platform-errors";

export function assertUberEatsWebhookConfigured(environment: NodeJS.ProcessEnv = process.env) {
  if (!environment.UBER_EATS_WEBHOOK_SECRET_REFERENCE?.trim()) {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }
}
