import { describe, expect, it } from "vitest";
import type {
  PublicMenuBundleChoiceGroup,
  PublicMenuNoteGroup,
  PublicMenuProduct,
} from "@/lib/public-menu-types";
import type { QrCartLine } from "@/lib/qr-cart";
import {
  canUpdateQrProductDraftQuantity,
  commitQrProductDraft,
  initialQrOrderProductState,
  qrOrderProductReducer,
  reconcileQrOrderProductState,
  type QrOrderProductState,
} from "./qr-order-product-controller";

const limits = {
  maxItemQuantity: 5,
  maxUniqueProducts: 3,
  maxTotalQuantity: 8,
  maxNoteLength: 200,
};

const spice: PublicMenuNoteGroup = {
  id: "spice",
  name: "Spice",
  selectionMode: "SINGLE",
  isRequired: true,
  minSelections: 1,
  maxSelections: 1,
  sortOrder: 0,
  translations: [],
  options: [
    { id: "mild", name: "Mild", priceDelta: 0, sortOrder: 0, translations: [] },
    { id: "hot", name: "Hot", priceDelta: 0, sortOrder: 1, translations: [] },
  ],
};

const side: PublicMenuBundleChoiceGroup = {
  id: "side",
  name: "Side",
  minSelections: 1,
  maxSelections: 1,
  sortOrder: 0,
  options: [{
    id: "fries",
    componentProductId: "fries-product",
    componentProductName: "Fries",
    quantity: 1,
    priceDelta: 0,
    sortOrder: 0,
  }],
};

function product(
  id: string,
  overrides: Partial<PublicMenuProduct> = {},
): PublicMenuProduct {
  return {
    id,
    name: id,
    description: "",
    price: 100,
    kind: "SINGLE",
    category: "main",
    rank: null,
    isBestSeller: false,
    isSoldOut: false,
    isOrderDiscountEligible: true,
    imageUrl: null,
    translations: [],
    noteGroups: [],
    bundleChoiceGroups: [],
    ...overrides,
  };
}

function line(
  id: string,
  productId: string,
  overrides: Partial<QrCartLine> = {},
): QrCartLine {
  return {
    id,
    productId,
    quantity: 1,
    note: "",
    noteOptionIds: [],
    bundleChoiceIds: [],
    ...overrides,
  };
}

describe("QR order product controller", () => {
  it("opens one configurable draft and applies note and bundle selection rules", () => {
    const opened = qrOrderProductReducer(initialQrOrderProductState, {
      type: "SET_QUANTITY",
      productId: "meal",
      quantity: 2,
    });
    const withNote = qrOrderProductReducer(opened, {
      type: "SELECT_NOTE",
      productId: "meal",
      group: spice,
      optionId: "hot",
    });
    const withBundle = qrOrderProductReducer(withNote, {
      type: "SELECT_BUNDLE",
      productId: "meal",
      group: side,
      choiceId: "fries",
    });

    expect(withBundle).toEqual({
      drafts: {
        meal: {
          quantity: 2,
          noteOptionIds: ["hot"],
          bundleChoiceIds: ["fries"],
        },
      },
      editingLineIds: {},
      configuringProductId: "meal",
    });
  });

  it("characterizes cancel, edit, edited quantity sync, and lottery state transitions", () => {
    const edited = qrOrderProductReducer(initialQrOrderProductState, {
      type: "EDIT_LINE",
      line: line("line-1", "meal", {
        quantity: 2,
        noteOptionIds: ["hot"],
        bundleChoiceIds: ["fries"],
      }),
    });
    const synchronized = qrOrderProductReducer(edited, {
      type: "SYNC_LINE_QUANTITY",
      line: line("line-1", "meal"),
      quantity: 3,
    });
    const lottery = qrOrderProductReducer(synchronized, {
      type: "LOTTERY_PRODUCT",
      productId: "meal",
    });
    const cancelled = qrOrderProductReducer(lottery, { type: "CLOSE", productId: "meal" });

    expect(synchronized.drafts.meal.quantity).toBe(3);
    expect(lottery).toMatchObject({
      drafts: { meal: { quantity: 1, noteOptionIds: ["hot"], bundleChoiceIds: ["fries"] } },
      editingLineIds: {},
      configuringProductId: "meal",
    });
    expect(cancelled).toEqual(initialQrOrderProductState);
  });

  it("rejects missing required selections before changing the cart", () => {
    expect(commitQrProductDraft({
      product: product("meal", { noteGroups: [spice], bundleChoiceGroups: [side] }),
      draft: { quantity: 1, noteOptionIds: [], bundleChoiceIds: [] },
      editingLineId: undefined,
      cartLines: [],
      limits,
      createLineId: () => "new-line",
    })).toEqual({ status: "INVALID_SELECTION" });
  });

  it("excludes the edited line from aggregate limits while blocking a new duplicate quantity", () => {
    const cartLines = [
      line("meal-line", "meal", { quantity: 5 }),
      line("drink-line", "drink", { quantity: 3 }),
    ];

    expect(canUpdateQrProductDraftQuantity({
      productId: "meal",
      currentQuantity: 5,
      quantity: 5,
      editingLineId: "meal-line",
      cartLines,
      limits,
    })).toBe(true);
    expect(canUpdateQrProductDraftQuantity({
      productId: "meal",
      currentQuantity: 0,
      quantity: 1,
      editingLineId: undefined,
      cartLines,
      limits,
    })).toBe(false);
  });

  it("adds a configured variant and replaces only its edited line", () => {
    const configuredProduct = product("meal", { noteGroups: [spice], bundleChoiceGroups: [side] });
    const draft = { quantity: 2, noteOptionIds: ["hot"], bundleChoiceIds: ["fries"] };
    const added = commitQrProductDraft({
      product: configuredProduct,
      draft,
      editingLineId: undefined,
      cartLines: [line("other", "drink")],
      limits,
      createLineId: () => "new-line",
    });
    const replaced = commitQrProductDraft({
      product: configuredProduct,
      draft: { ...draft, quantity: 3 },
      editingLineId: "meal-line",
      cartLines: [
        line("meal-line", "meal", { noteOptionIds: ["mild"], bundleChoiceIds: ["fries"] }),
        line("other-variant", "meal", { noteOptionIds: ["hot"], bundleChoiceIds: ["fries"] }),
      ],
      limits,
      createLineId: () => "must-not-be-used",
    });

    expect(added).toMatchObject({
      status: "COMMITTED",
      cartLines: [{ id: "other" }, { id: "new-line", productId: "meal", quantity: 2 }],
    });
    expect(replaced).toMatchObject({
      status: "COMMITTED",
      cartLines: [
        { id: "meal-line", productId: "meal", quantity: 4, noteOptionIds: ["hot"] },
      ],
    });
  });

  it("reconciles PREORDER availability and opens the first line whose choices became invalid", () => {
    const previous: QrOrderProductState = {
      drafts: {
        removed: { quantity: 1, noteOptionIds: [], bundleChoiceIds: [] },
        meal: { quantity: 2, noteOptionIds: ["retired"], bundleChoiceIds: [] },
      },
      editingLineIds: { removed: "removed-line", meal: "meal-line" },
      configuringProductId: "removed",
    };
    const availableMeal = product("meal", { noteGroups: [spice] });
    const cartLines = [line("meal-line", "meal", { noteOptionIds: ["retired"] })];

    expect(reconcileQrOrderProductState(previous, [availableMeal], cartLines)).toEqual({
      drafts: {
        meal: { quantity: 2, noteOptionIds: [], bundleChoiceIds: [] },
      },
      editingLineIds: { meal: "meal-line" },
      configuringProductId: "meal",
    });
  });
});
