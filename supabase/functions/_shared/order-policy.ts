export type QrAccessInput = {
  qrState: "ACTIVE" | "PAUSED" | "EXPIRED" | "REVOKED";
  qrExpiresAt?: Date | null;
  orderingState: "OPEN" | "PAUSED" | "CLOSED";
  stallActive: boolean;
  soldOut: boolean;
};

export function evaluateQrAccess(input: QrAccessInput, now = new Date()) {
  if (input.qrState === "REVOKED") return "QR_REVOKED";
  if (input.qrState === "PAUSED") return "QR_PAUSED";
  if (input.qrState === "EXPIRED" || (input.qrExpiresAt && input.qrExpiresAt <= now)) return "QR_EXPIRED";
  if (!input.stallActive || input.orderingState === "CLOSED") return "STALL_CLOSED";
  if (input.orderingState === "PAUSED") return "ORDERING_PAUSED";
  if (input.soldOut) return "STALL_SOLD_OUT";
  return null;
}

export function evaluateSessionAccess(input: {
  status: "ACTIVE" | "CONSUMED" | "EXPIRED" | "REVOKED";
  expiresAt: Date;
  expectedDeviceHash: string;
  actualDeviceHash: string;
}, now = new Date()) {
  if (input.status !== "ACTIVE") return "SESSION_REPLAYED";
  if (input.expiresAt <= now) return "SESSION_EXPIRED";
  if (input.expectedDeviceHash !== input.actualDeviceHash) return "SESSION_DEVICE_MISMATCH";
  return null;
}

export function validateOrderLimits(
  items: Array<{ productId: string; quantity: number }>,
  note: string,
  limits: { maxItemQuantity: number; maxUniqueProducts: number; maxTotalQuantity: number; maxNoteLength: number },
) {
  if (items.length === 0) return "INVALID_ITEMS";
  if (items.length > limits.maxUniqueProducts || new Set(items.map((item) => item.productId)).size !== items.length) {
    return "TOO_MANY_OR_DUPLICATE_PRODUCTS";
  }
  if (items.some((item) => item.quantity < 1 || item.quantity > limits.maxItemQuantity)) {
    return "EXCESSIVE_ITEM_QUANTITY";
  }
  if (items.reduce((sum, item) => sum + item.quantity, 0) > limits.maxTotalQuantity) {
    return "EXCESSIVE_TOTAL_QUANTITY";
  }
  if (note.length > limits.maxNoteLength) return "NOTE_TOO_LONG";
  return null;
}

export function consumeFixedWindow(currentCount: number, limit: number) {
  const nextCount = currentCount + 1;
  return { count: nextCount, allowed: nextCount <= limit };
}

export function canReadPublicOrder(
  presentedTrackingHash: string,
  storedTrackingHash: string,
  presentedDeviceHash: string,
  storedDeviceHash: string,
) {
  return presentedTrackingHash.length === 64
    && presentedTrackingHash === storedTrackingHash
    && presentedDeviceHash === storedDeviceHash;
}
