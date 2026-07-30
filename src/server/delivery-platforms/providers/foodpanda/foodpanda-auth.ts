import { DeliveryPlatformError } from "../../delivery-platform-errors";

export function getFoodpandaPartnerConfig(environment: NodeJS.ProcessEnv = process.env) {
  const credentialReference = environment.FOODPANDA_CREDENTIAL_REFERENCE?.trim();
  const webhookReference = environment.FOODPANDA_WEBHOOK_CREDENTIAL_REFERENCE?.trim();
  if (!credentialReference || !webhookReference) {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }
  return { credentialReference, webhookReference };
}
