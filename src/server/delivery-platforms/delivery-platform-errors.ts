export type DeliveryPlatformErrorCode =
  | "BACKEND_NOT_WRITABLE"
  | "CONNECTION_NOT_FOUND"
  | "CONNECTION_STATE_CONFLICT"
  | "DUPLICATE_EVENT"
  | "INVALID_CREDENTIALS"
  | "INVALID_WEBHOOK"
  | "MAPPING_REQUIRED"
  | "PERMISSION_DENIED"
  | "PROVIDER_DISABLED"
  | "PROVIDER_NOT_APPROVED"
  | "PROVIDER_UNAVAILABLE"
  | "RETRYABLE_PROVIDER_ERROR"
  | "STORE_NOT_FOUND"
  | "UNSUPPORTED_MAPPING";

const permanentErrorCodes = new Set<DeliveryPlatformErrorCode>([
  "CONNECTION_NOT_FOUND",
  "CONNECTION_STATE_CONFLICT",
  "INVALID_CREDENTIALS",
  "INVALID_WEBHOOK",
  "MAPPING_REQUIRED",
  "PERMISSION_DENIED",
  "PROVIDER_DISABLED",
  "PROVIDER_NOT_APPROVED",
  "STORE_NOT_FOUND",
  "UNSUPPORTED_MAPPING",
]);

export class DeliveryPlatformError extends Error {
  readonly retryable: boolean;

  constructor(readonly code: DeliveryPlatformErrorCode, options: { retryable?: boolean } = {}) {
    super(code);
    this.retryable = options.retryable ?? !permanentErrorCodes.has(code);
  }
}

export function safeDeliveryErrorCode(error: unknown): DeliveryPlatformErrorCode {
  return error instanceof DeliveryPlatformError
    ? error.code
    : "PROVIDER_UNAVAILABLE";
}
