export const QR_CAPACITY_REFRESH_INTERVAL_MS = 60_000;

export function shouldRefreshQrCapacity(input: {
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER";
  sessionReady: boolean;
  secondsRemaining: number;
  visibilityState: DocumentVisibilityState;
  sessionRequestId: string | null;
  lastRefreshAt: number;
  now: number;
}) {
  return input.orderingMode !== "PREORDER"
    && input.sessionReady
    && input.secondsRemaining > 0
    && input.visibilityState === "visible"
    && Boolean(input.sessionRequestId)
    && input.now - input.lastRefreshAt >= QR_CAPACITY_REFRESH_INTERVAL_MS;
}
