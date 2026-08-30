export const invoiceRetryMaxAttempts = 5;

export function calculateInvoiceRetry(input: {
  attempt: number;
  now?: Date;
  jitter?: number;
  maxAttempts?: number;
}) {
  const maxAttempts = input.maxAttempts ?? invoiceRetryMaxAttempts;
  const nextAttempt = input.attempt + 1;
  if (nextAttempt >= maxAttempts) return { status: "DEAD_LETTERED" as const, nextAttemptAt: null, attempt: nextAttempt };
  const baseSeconds = Math.min(15 * (2 ** Math.max(0, input.attempt)), 15 * 60);
  const boundedJitter = Math.max(0, Math.min(input.jitter ?? 0.5, 1));
  const delayMs = Math.round(baseSeconds * (0.8 + boundedJitter * 0.4) * 1_000);
  return {
    status: "RETRY_SCHEDULED" as const,
    nextAttemptAt: new Date((input.now ?? new Date()).getTime() + delayMs),
    attempt: nextAttempt,
  };
}

