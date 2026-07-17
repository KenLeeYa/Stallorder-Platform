import { describe, expect, it } from "vitest";
import { QR_CART_TTL_MS, restoreQrCartDraft, serializeQrCartDraft } from "./qr-cart";

const products = [
  { id: "p1", noteGroups: [{ options: [{ id: "o1" }] }] },
  { id: "p2", noteGroups: [] },
];
const limits = { maxItemQuantity: 3, maxUniqueProducts: 2, maxTotalQuantity: 4, maxNoteLength: 5 };

describe("QR 購物車復原", () => {
  it("依目前商品與限制清理暫存內容", () => {
    const raw = serializeQrCartDraft({
      customerName: "王小明",
      customerNote: "123456789",
      quantities: { p1: 8, p2: 3, removed: 1 },
      noteSelections: { p1: ["o1", "invalid", "o1"] },
    }, 1_000);

    expect(restoreQrCartDraft(raw, products, limits, 2_000)).toMatchObject({
      customerName: "王小明",
      customerNote: "12345",
      quantities: { p1: 3, p2: 1 },
      noteSelections: { p1: ["o1"] },
    });
  });

  it("不恢復逾期或格式錯誤的資料", () => {
    const raw = serializeQrCartDraft({
      customerName: "",
      customerNote: "",
      quantities: { p1: 1 },
      noteSelections: {},
    }, 1_000);
    expect(restoreQrCartDraft(raw, products, limits, 1_000 + QR_CART_TTL_MS + 1)).toBeNull();
    expect(restoreQrCartDraft("not-json", products, limits)).toBeNull();
  });
});
