import { DeliveryPlatformError } from "../../delivery-platform-errors";
import type { NormalizedExternalOrder } from "../../delivery-platform-types";

export function normalizeUberEatsOrder(payload: unknown): NormalizedExternalOrder {
  void payload;
  throw new DeliveryPlatformError("PROVIDER_NOT_APPROVED", { retryable: false });
}
