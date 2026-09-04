import { describe, expect, it, vi } from "vitest";
import { persistQrOrderCartDraft } from "@/components/qr-order-cart-persistence";

const line = {
  id: "line-meal",
  productId: "meal",
  quantity: 2,
  note: "",
  noteOptionIds: [],
  bundleChoiceIds: [],
};

describe("QR order cart draft persistence", () => {
  it("does nothing until a session and restored cart are ready", () => {
    const storage = createStorage();

    persistQrOrderCartDraft(input({ sessionReady: false, cartReady: true }), () => storage);
    persistQrOrderCartDraft(input({ sessionReady: true, cartReady: false }), () => storage);

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("serializes a scoped draft when any restorable field is present", () => {
    const storage = createStorage();

    persistQrOrderCartDraft(input({
      orderingMode: "PREORDER",
      scheduledPickupAt: "2026-08-13T02:00:00.000Z",
      customerName: "Lin",
      lines: [line],
      now: 1_700_000_000_000,
    }), () => storage);

    expect(storage.setItem).toHaveBeenCalledOnce();
    const [key, raw] = storage.setItem.mock.calls[0];
    expect(key).toBe("stallorder_qr_cart:qr%2Ftoken:preorder");
    expect(JSON.parse(raw)).toEqual({
      version: 3,
      savedAt: 1_700_000_000_000,
      orderingMode: "PREORDER",
      scheduledPickupAt: "2026-08-13T02:00:00.000Z",
      customerName: "Lin",
      customerNote: "",
      customerPhone: "",
      deliveryAddress: "",
      lines: [line],
    });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("keeps pickup contact details in an order-specific edit draft", () => {
    const storage = createStorage();

    persistQrOrderCartDraft(input({
      editTrackingToken: "sto_pickup/order",
      orderingMode: "PREORDER",
      customerName: "王小明",
      customerPhone: "0912345678",
      lines: [line],
    }), () => storage);

    expect(storage.setItem).toHaveBeenCalledOnce();
    const [key, raw] = storage.setItem.mock.calls[0];
    expect(key).toBe("stallorder_qr_order_edit:sto_pickup%2Forder");
    expect(JSON.parse(raw)).toMatchObject({
      customerName: "王小明",
      customerPhone: "0912345678",
    });
  });

  it("removes the scoped key when all draft fields are empty", () => {
    const storage = createStorage();

    persistQrOrderCartDraft(input({ orderingMode: "DELIVERY" }), () => storage);

    expect(storage.removeItem).toHaveBeenCalledWith("stallorder_qr_cart:qr%2Ftoken:delivery");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("fails safe when restricted storage throws while writing or removing", () => {
    const writeStorage = createStorage();
    writeStorage.setItem.mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const removeStorage = createStorage();
    removeStorage.removeItem.mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(() => persistQrOrderCartDraft(input({ lines: [line] }), () => writeStorage)).not.toThrow();
    expect(() => persistQrOrderCartDraft(input(), () => removeStorage)).not.toThrow();
    expect(() => persistQrOrderCartDraft(input({ lines: [line] }), () => {
      throw new DOMException("denied", "SecurityError");
    })).not.toThrow();
  });
});

function input(overrides: Partial<Parameters<typeof persistQrOrderCartDraft>[0]> = {}) {
  return {
    sessionReady: true,
    cartReady: true,
    qrToken: "qr/token",
    orderingMode: "DEFAULT" as const,
    scheduledPickupAt: "",
    customerName: "",
    customerNote: "",
    customerPhone: "",
    deliveryAddress: "",
    lines: [],
    now: 1_700_000_000_000,
    ...overrides,
  };
}

function createStorage() {
  return {
    setItem: vi.fn<(key: string, value: string) => void>(),
    removeItem: vi.fn<(key: string) => void>(),
  };
}
