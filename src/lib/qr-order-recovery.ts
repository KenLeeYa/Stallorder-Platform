const QR_ORDER_RECOVERY_KEY_PREFIX = "stallorder_qr_order_recovery:v1:";
const QR_ORDER_RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFINITIVELY_MISSING_ORDER_STATUSES = new Set([401, 403, 404, 410]);
const FINISHED_ORDER_STATUSES = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);

type QrOrderRecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type QrOrderRecoveryReference = {
  qrToken: string;
  trackingToken: string;
  deviceId: string;
  expiresAt: number;
};

type QrOrderRecoveryInput = Pick<
  QrOrderRecoveryReference,
  "qrToken" | "trackingToken" | "deviceId"
>;

export function persistQrOrderRecovery(
  storage: QrOrderRecoveryStorage,
  input: QrOrderRecoveryInput,
  now = Date.now(),
) {
  if (!validRecoveryInput(input)) return;
  try {
    storage.setItem(recoveryStorageKey(input.qrToken), JSON.stringify({
      ...input,
      expiresAt: now + QR_ORDER_RECOVERY_TTL_MS,
    }));
  } catch {
    // Restricted browser storage must not block a completed checkout.
  }
}

export function readQrOrderRecovery(
  storage: QrOrderRecoveryStorage,
  qrToken: string,
  now = Date.now(),
): QrOrderRecoveryReference | null {
  try {
    const key = recoveryStorageKey(qrToken);
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QrOrderRecoveryReference>;
    const expiresAt = parsed.expiresAt;
    if (
      !validRecoveryInput(parsed)
      || parsed.qrToken !== qrToken
      || typeof expiresAt !== "number"
      || !Number.isFinite(expiresAt)
      || expiresAt <= now
    ) {
      storage.removeItem(key);
      return null;
    }
    return { ...parsed, expiresAt } as QrOrderRecoveryReference;
  } catch {
    return null;
  }
}

export function clearQrOrderRecovery(
  storage: QrOrderRecoveryStorage,
  qrToken: string,
) {
  try {
    storage.removeItem(recoveryStorageKey(qrToken));
  } catch {
    // Recovery cleanup is best effort when browser storage is restricted.
  }
}

export async function resolveQrOrderRecovery({
  storage,
  qrToken,
  startNewOrder = false,
  now = Date.now(),
  validateOrder,
}: {
  storage: QrOrderRecoveryStorage;
  qrToken: string;
  startNewOrder?: boolean;
  now?: number;
  validateOrder: (
    reference: Pick<QrOrderRecoveryReference, "trackingToken" | "deviceId">,
  ) => Promise<Response>;
}) {
  if (startNewOrder) {
    clearQrOrderRecovery(storage, qrToken);
    return null;
  }
  const reference = readQrOrderRecovery(storage, qrToken, now);
  if (!reference) return null;
  try {
    const response = await validateOrder({
      trackingToken: reference.trackingToken,
      deviceId: reference.deviceId,
    });
    if (response.ok) {
      const payload = await response.clone().json().catch(() => null) as {
        order?: { orderStatus?: unknown };
      } | null;
      const orderStatus = payload?.order?.orderStatus;
      if (typeof orderStatus === "string" && FINISHED_ORDER_STATUSES.has(orderStatus)) {
        clearQrOrderRecovery(storage, qrToken);
        return null;
      }
      return reference;
    }
    if (DEFINITIVELY_MISSING_ORDER_STATUSES.has(response.status)) {
      clearQrOrderRecovery(storage, qrToken);
      return null;
    }
  } catch {
    // Prefer the known order screen over creating a duplicate while offline.
  }
  return reference;
}

export function buildQrTrackedOrderPath(trackingToken: string, qrToken: string) {
  return `/order/${encodeURIComponent(trackingToken)}?qr=${encodeURIComponent(qrToken)}`;
}

export function buildQrNewOrderPath(qrToken: string) {
  return `/q/${encodeURIComponent(qrToken)}?newOrder=1`;
}

function recoveryStorageKey(qrToken: string) {
  return `${QR_ORDER_RECOVERY_KEY_PREFIX}${encodeURIComponent(qrToken)}`;
}

function validRecoveryInput(input: Partial<QrOrderRecoveryInput>): input is QrOrderRecoveryInput {
  return typeof input.qrToken === "string"
    && input.qrToken.trim().length >= 24
    && input.qrToken.length <= 200
    && typeof input.trackingToken === "string"
    && /^[A-Za-z0-9_-]{40,200}$/.test(input.trackingToken)
    && typeof input.deviceId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.deviceId);
}
