import { describe, expect, it } from "vitest";
import { canReadPublicOrder, consumeFixedWindow, evaluateQrAccess, evaluateSessionAccess, validateOrderLimits } from "./order-policy";

describe("QR 點餐防濫用規則", () => {
  it("拒絕撤銷與過期 QR", () => {
    expect(evaluateQrAccess({ qrState: "REVOKED", orderingState: "OPEN", stallActive: true, soldOut: false })).toBe("QR_REVOKED");
    expect(evaluateQrAccess({ qrState: "EXPIRED", orderingState: "OPEN", stallActive: true, soldOut: false })).toBe("QR_EXPIRED");
  });

  it("拒絕關閉與暫停點餐", () => {
    expect(evaluateQrAccess({ qrState: "ACTIVE", orderingState: "CLOSED", stallActive: true, soldOut: false })).toBe("STALL_CLOSED");
    expect(evaluateQrAccess({ qrState: "ACTIVE", orderingState: "PAUSED", stallActive: true, soldOut: false })).toBe("ORDERING_PAUSED");
  });

  it("拒絕逾時、重播及跨裝置 session", () => {
    const now = new Date("2026-07-13T00:00:00Z");
    expect(evaluateSessionAccess({ status: "ACTIVE", expiresAt: now, expectedDeviceHash: "a", actualDeviceHash: "a" }, now)).toBe("SESSION_EXPIRED");
    expect(evaluateSessionAccess({ status: "CONSUMED", expiresAt: new Date("2026-07-13T00:10:00Z"), expectedDeviceHash: "a", actualDeviceHash: "a" }, now)).toBe("SESSION_REPLAYED");
    expect(evaluateSessionAccess({ status: "ACTIVE", expiresAt: new Date("2026-07-13T00:10:00Z"), expectedDeviceHash: "a", actualDeviceHash: "b" }, now)).toBe("SESSION_DEVICE_MISMATCH");
  });

  it("由伺服器限制商品與總數量", () => {
    const limits = { maxItemQuantity: 3, maxUniqueProducts: 2, maxTotalQuantity: 4, maxNoteLength: 20 };
    expect(validateOrderLimits([{ productId: "a", quantity: 4 }], "", limits)).toBe("EXCESSIVE_ITEM_QUANTITY");
    expect(validateOrderLimits([{ productId: "a", quantity: 3 }, { productId: "b", quantity: 2 }], "", limits)).toBe("EXCESSIVE_TOTAL_QUANTITY");
  });

  it("固定時間窗超限後拒絕", () => {
    expect(consumeFixedWindow(0, 1)).toEqual({ count: 1, allowed: true });
    expect(consumeFixedWindow(1, 1)).toEqual({ count: 2, allowed: false });
  });

  it("公開訂單查詢同時綁定 tracking 與裝置", () => {
    const hash = "a".repeat(64);
    expect(canReadPublicOrder(hash, hash, "device-a", "device-a")).toBe(true);
    expect(canReadPublicOrder(hash, hash, "device-b", "device-a")).toBe(false);
  });
});
