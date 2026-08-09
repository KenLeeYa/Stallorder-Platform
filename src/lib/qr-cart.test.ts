import { describe, expect, it } from "vitest";
import {
  addQrCartLine,
  QR_CART_TTL_MS,
  qrCartLineKey,
  replaceQrCartLine,
  restoreQrCartDraft,
  serializeQrCartDraft,
  updateQrCartLineQuantity,
  type QrCartLine,
} from "./qr-cart";

const products = [
  {
    id: "p1",
    noteGroups: [{ options: [{ id: "o1" }, { id: "o2" }] }],
    bundleChoiceGroups: [{ options: [{ id: "b1" }, { id: "b2" }] }],
  },
  { id: "p2", noteGroups: [] },
];
const limits = { maxItemQuantity: 3, maxUniqueProducts: 2, maxTotalQuantity: 4, maxNoteLength: 5 };

function line(overrides: Partial<QrCartLine> = {}): QrCartLine {
  return {
    id: "line-1",
    productId: "p1",
    quantity: 1,
    note: "",
    noteOptionIds: ["o1"],
    bundleChoiceIds: ["b1"],
    ...overrides,
  };
}

describe("QR cart lines", () => {
  it("restores the legacy per-product draft as versioned cart lines", () => {
    const raw = JSON.stringify({
      savedAt: 1_000,
      customerName: "測試客人",
      customerNote: "123456789",
      customerPhone: "0912345678",
      deliveryAddress: "台北市測試路 1 號",
      quantities: { p1: 8, p2: 3, removed: 1 },
      noteSelections: { p1: ["o1", "invalid", "o1"] },
      bundleSelections: { p1: ["b1", "invalid", "b1"] },
    });

    expect(restoreQrCartDraft(raw, products, limits, 2_000)).toMatchObject({
      version: 3,
      orderingMode: "DEFAULT",
      scheduledPickupAt: "",
      customerName: "測試客人",
      customerNote: "12345",
      customerPhone: "0912345678",
      deliveryAddress: "台北市測試路 1 號",
      lines: [
        {
          productId: "p1",
          quantity: 3,
          noteOptionIds: ["o1"],
          bundleChoiceIds: ["b1"],
        },
        {
          productId: "p2",
          quantity: 1,
          noteOptionIds: [],
          bundleChoiceIds: [],
        },
      ],
    });
  });

  it("keeps two variants of one product and merges only identical configurations", () => {
    const raw = serializeQrCartDraft({
      orderingMode: "DEFAULT",
      scheduledPickupAt: "",
      customerName: "",
      customerNote: "",
      lines: [
        line({ id: "first", noteOptionIds: ["o1"], bundleChoiceIds: ["b1"] }),
        line({ id: "second", noteOptionIds: ["o2"], bundleChoiceIds: ["b1"] }),
        line({ id: "duplicate", noteOptionIds: ["o1"], bundleChoiceIds: ["b1"] }),
      ],
    }, 1_000);

    expect(restoreQrCartDraft(raw, products, limits, 2_000)?.lines).toEqual([
      line({ id: "first", quantity: 2, noteOptionIds: ["o1"], bundleChoiceIds: ["b1"] }),
      line({ id: "second", noteOptionIds: ["o2"], bundleChoiceIds: ["b1"] }),
    ]);
  });

  it("canonicalizes option order but keeps note and bundle variants distinct", () => {
    expect(qrCartLineKey(line({ noteOptionIds: ["o2", "o1"], bundleChoiceIds: ["b2", "b1"] })))
      .toBe(qrCartLineKey(line({ noteOptionIds: ["o1", "o2"], bundleChoiceIds: ["b1", "b2"] })));
    expect(qrCartLineKey(line({ note: "少冰" }))).not.toBe(qrCartLineKey(line({ note: "" })));
  });

  it("adds independent variants, merges identical lines, and enforces aggregate product limits", () => {
    const first = addQrCartLine([], {
      productId: "p1",
      quantity: 1,
      note: "",
      noteOptionIds: ["o1"],
      bundleChoiceIds: [],
    }, limits, () => "first")!;
    const variant = addQrCartLine(first, {
      productId: "p1",
      quantity: 1,
      note: "",
      noteOptionIds: ["o2"],
      bundleChoiceIds: [],
    }, limits, () => "variant")!;
    const merged = addQrCartLine(variant, {
      productId: "p1",
      quantity: 1,
      note: "",
      noteOptionIds: ["o1"],
      bundleChoiceIds: [],
    }, limits, () => "unused")!;

    expect(merged).toEqual([
      expect.objectContaining({ id: "first", quantity: 2, noteOptionIds: ["o1"] }),
      expect.objectContaining({ id: "variant", quantity: 1, noteOptionIds: ["o2"] }),
    ]);
    expect(addQrCartLine(merged, {
      productId: "p1",
      quantity: 1,
      note: "",
      noteOptionIds: [],
      bundleChoiceIds: [],
    }, limits, () => "over-limit")).toBeNull();
  });

  it("enforces aggregate limits when a cart line quantity changes", () => {
    const lines = [
      line({ id: "first", quantity: 1, noteOptionIds: ["o1"] }),
      line({ id: "second", quantity: 1, noteOptionIds: ["o2"] }),
    ];
    expect(updateQrCartLineQuantity(lines, "first", 2, limits)?.[0]?.quantity).toBe(2);
    expect(updateQrCartLineQuantity(lines, "first", 3, limits)).toBeNull();
    expect(updateQrCartLineQuantity(lines, "first", 0, limits)).toEqual([lines[1]]);
  });

  it("replaces a customized line in place and preserves its id and position", () => {
    const lines = [
      line({ id: "first", noteOptionIds: ["o1"] }),
      line({ id: "second", noteOptionIds: ["o2"] }),
    ];

    expect(replaceQrCartLine(lines, "first", {
      productId: "p1",
      quantity: 2,
      note: "",
      noteOptionIds: ["o2"],
      bundleChoiceIds: ["b2"],
    }, limits)).toEqual([
      line({
        id: "first",
        quantity: 2,
        noteOptionIds: ["o2"],
        bundleChoiceIds: ["b2"],
      }),
      lines[1],
    ]);
  });

  it("merges a matching variant into the edited line without adding a cart line", () => {
    const lines = [
      line({ id: "first", noteOptionIds: ["o1"], bundleChoiceIds: [] }),
      line({ id: "second", quantity: 2, noteOptionIds: ["o2"], bundleChoiceIds: [] }),
    ];

    expect(replaceQrCartLine(lines, "first", {
      productId: "p1",
      quantity: 1,
      note: "",
      noteOptionIds: ["o2"],
      bundleChoiceIds: [],
    }, limits)).toEqual([
      line({ id: "first", quantity: 3, noteOptionIds: ["o2"], bundleChoiceIds: [] }),
    ]);
  });

  it("discards expired and malformed drafts", () => {
    const raw = serializeQrCartDraft({
      orderingMode: "DEFAULT",
      scheduledPickupAt: "",
      customerName: "",
      customerNote: "",
      lines: [line()],
    }, 1_000);
    expect(restoreQrCartDraft(raw, products, limits, 1_000 + QR_CART_TTL_MS + 1)).toBeNull();
    expect(restoreQrCartDraft("not-json", products, limits)).toBeNull();
  });

  it("restores a PREORDER draft with its selected pickup time", () => {
    const selectedPickupAt = "2099-08-03T04:30:00.000Z";
    const raw = serializeQrCartDraft({
      orderingMode: "PREORDER",
      scheduledPickupAt: selectedPickupAt,
      customerName: "",
      customerNote: "",
      lines: [line()],
    }, 1_000);

    expect(restoreQrCartDraft(raw, products, limits, 2_000, {
      orderingMode: "PREORDER",
    })).toMatchObject({
      orderingMode: "PREORDER",
      scheduledPickupAt: selectedPickupAt,
      lines: [expect.objectContaining({ productId: "p1" })],
    });
  });

  it("rejects a current draft saved for another ordering mode", () => {
    const raw = serializeQrCartDraft({
      orderingMode: "PREORDER",
      scheduledPickupAt: "2099-08-03T04:30:00.000Z",
      customerName: "",
      customerNote: "",
      lines: [line()],
    }, 1_000);

    expect(restoreQrCartDraft(raw, products, limits, 2_000, {
      orderingMode: "DEFAULT",
    })).toBeNull();
  });

  it("restores a DELIVERY draft with its selected delivery time", () => {
    const selectedDeliveryAt = "2099-08-03T05:05:00.000Z";
    const raw = serializeQrCartDraft({
      orderingMode: "DELIVERY",
      scheduledPickupAt: selectedDeliveryAt,
      customerName: "外送客人",
      customerNote: "",
      customerPhone: "0912345678",
      deliveryAddress: "台北市測試路 1 號",
      lines: [line()],
    }, 1_000);

    expect(restoreQrCartDraft(raw, products, limits, 2_000, {
      orderingMode: "DELIVERY",
    })).toMatchObject({
      orderingMode: "DELIVERY",
      scheduledPickupAt: selectedDeliveryAt,
      customerPhone: "0912345678",
      deliveryAddress: "台北市測試路 1 號",
    });
  });

  it("keeps version 2 line drafts readable within the current storage scope", () => {
    const raw = JSON.stringify({
      version: 2,
      savedAt: 1_000,
      customerName: "",
      customerNote: "",
      lines: [line()],
    });

    expect(restoreQrCartDraft(raw, products, limits, 2_000, {
      orderingMode: "PREORDER",
    })).toMatchObject({
      version: 3,
      orderingMode: "PREORDER",
      scheduledPickupAt: "",
      lines: [expect.objectContaining({ productId: "p1" })],
    });
  });
});
