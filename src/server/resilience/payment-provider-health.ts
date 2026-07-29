export const paymentProviderStatuses = [
  "AVAILABLE",
  "DEGRADED",
  "UNAVAILABLE",
  "MAINTENANCE",
  "UNKNOWN",
] as const;

export type PaymentProviderStatus = (typeof paymentProviderStatuses)[number];

export function resolvePaymentProviderStatus(
  featureEnabled: boolean,
  reportedStatus: string | undefined,
): PaymentProviderStatus {
  if (!featureEnabled) return "MAINTENANCE";
  const normalized = reportedStatus?.trim().toUpperCase();
  return paymentProviderStatuses.includes(normalized as PaymentProviderStatus)
    ? normalized as PaymentProviderStatus
    : "UNKNOWN";
}

export function buildPaymentFallbackPlan(
  linePay: PaymentProviderStatus,
  jkoPay: PaymentProviderStatus,
) {
  return {
    onlineProviders: [
      ...(linePay === "AVAILABLE" ? ["LINE_PAY" as const] : []),
      ...(jkoPay === "AVAILABLE" ? ["JKO_PAY" as const] : []),
    ],
    cashAllowed: true,
    manualPaymentAllowed: true,
  };
}
