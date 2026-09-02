import { describe, expect, it, vi } from "vitest";
import {
  buildQrTrackedOrderPath,
  clearQrOrderRecovery,
  persistQrOrderRecovery,
  readQrOrderRecovery,
  resolveQrOrderRecovery,
} from "./qr-order-recovery";

const qrToken = "qr_abcdefghijklmnopqrstuvwxyz123456";
const trackingToken = `sto_${"t".repeat(48)}`;
const deviceId = "11111111-1111-4111-8111-111111111111";
const now = Date.UTC(2026, 8, 2, 8, 0, 0);

describe("QR order recovery", () => {
  it("persists a device-bound order pointer for the same QR", () => {
    const storage = memoryStorage();

    persistQrOrderRecovery(storage, { qrToken, trackingToken, deviceId }, now);

    expect(readQrOrderRecovery(storage, qrToken, now)).toMatchObject({
      qrToken,
      trackingToken,
      deviceId,
    });
  });

  it("expires and removes stale recovery pointers", () => {
    const storage = memoryStorage();
    persistQrOrderRecovery(storage, { qrToken, trackingToken, deviceId }, now);

    expect(readQrOrderRecovery(storage, qrToken, now + 24 * 60 * 60 * 1_000 + 1)).toBeNull();
    expect(storage.size()).toBe(0);
  });

  it("validates the original order with its persisted device id before resuming", async () => {
    const storage = memoryStorage();
    persistQrOrderRecovery(storage, { qrToken, trackingToken, deviceId }, now);
    const validateOrder = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(resolveQrOrderRecovery({
      storage,
      qrToken,
      now,
      validateOrder,
    })).resolves.toMatchObject({ trackingToken, deviceId });
    expect(validateOrder).toHaveBeenCalledWith({ trackingToken, deviceId });
  });

  it("removes a definitively missing order but preserves recovery during infrastructure failure", async () => {
    const storage = memoryStorage();
    persistQrOrderRecovery(storage, { qrToken, trackingToken, deviceId }, now);

    await expect(resolveQrOrderRecovery({
      storage,
      qrToken,
      now,
      validateOrder: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    })).resolves.toBeNull();
    expect(readQrOrderRecovery(storage, qrToken, now)).toBeNull();

    persistQrOrderRecovery(storage, { qrToken, trackingToken, deviceId }, now);
    await expect(resolveQrOrderRecovery({
      storage,
      qrToken,
      now,
      validateOrder: vi.fn().mockRejectedValue(new Error("offline")),
    })).resolves.toMatchObject({ trackingToken, deviceId });
  });

  it("clears recovery only when the customer explicitly starts a new order", async () => {
    const storage = memoryStorage();
    persistQrOrderRecovery(storage, { qrToken, trackingToken, deviceId }, now);
    const validateOrder = vi.fn();

    await expect(resolveQrOrderRecovery({
      storage,
      qrToken,
      now,
      startNewOrder: true,
      validateOrder,
    })).resolves.toBeNull();
    expect(validateOrder).not.toHaveBeenCalled();
    expect(readQrOrderRecovery(storage, qrToken, now)).toBeNull();

    clearQrOrderRecovery(storage, qrToken);
    expect(storage.size()).toBe(0);
  });

  it("keeps the QR context on the tracked order URL", () => {
    expect(buildQrTrackedOrderPath(trackingToken, qrToken)).toBe(
      `/order/${trackingToken}?qr=${encodeURIComponent(qrToken)}`,
    );
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    size: () => values.size,
  };
}
