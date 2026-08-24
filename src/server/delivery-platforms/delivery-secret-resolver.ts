import { DeliveryPlatformError } from "./delivery-platform-errors";

const credentialReferencePattern = /^(vercel|supabase|external-secret-manager):\/\/[A-Za-z0-9_./:-]+$/;
const environmentKeyPattern = /^[A-Z][A-Z0-9_]{2,127}$/;

export type DeliverySecretResolver = (reference: string) => string;

export function resolveDeliverySecret(
  reference: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const normalizedReference = reference.trim();
  if (!credentialReferencePattern.test(normalizedReference)) {
    throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  const finalSegment = normalizedReference.split(/[/:]/).filter(Boolean).at(-1) ?? "";
  if (!environmentKeyPattern.test(finalSegment)) {
    throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  const secret = environment[finalSegment]?.trim();
  if (!secret) {
    throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
  }
  return secret;
}

export function createEnvironmentDeliverySecretResolver(
  environment: NodeJS.ProcessEnv = process.env,
): DeliverySecretResolver {
  return (reference) => resolveDeliverySecret(reference, environment);
}
