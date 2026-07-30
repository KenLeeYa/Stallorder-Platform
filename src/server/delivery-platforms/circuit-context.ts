import type { DeliveryCircuitSource } from "./delivery-platform-types";

const acceptedSources = new Set<DeliveryCircuitSource>([
  "CIRCUIT_A_EDGE",
  "CIRCUIT_B_VERCEL",
  "BACKGROUND_JOB",
  "PLATFORM_ADMIN",
]);

export function parseDeliveryCircuitSource(value: string | null): DeliveryCircuitSource {
  const normalized = value?.trim().toUpperCase() as DeliveryCircuitSource | undefined;
  return normalized && acceptedSources.has(normalized) ? normalized : "UNKNOWN";
}
