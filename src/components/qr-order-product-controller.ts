import { useCallback, useReducer, type Dispatch, type SetStateAction } from "react";
import {
  addQrCartLine,
  qrCartProductQuantity,
  qrCartTotalQuantity,
  replaceQrCartLine,
  updateQrCartLineQuantity,
  type QrCartLimits,
  type QrCartLine,
  type QrCartOrderingMode,
} from "@/lib/qr-cart";
import {
  bundleSelectionIsValid,
  toggleBundleChoice,
} from "@/lib/product-bundle-selection";
import { noteSelectionIsValid, toggleNoteOption } from "@/lib/product-note-selection";
import {
  prunePublicCartLinesForProducts,
  publicMenuProductsForPickup,
} from "@/lib/public-menu-availability";
import type {
  PublicMenuBundleChoiceGroup,
  PublicMenuNoteGroup,
  PublicMenuProduct,
} from "@/lib/public-menu-types";
import { createWebUuid } from "@/lib/web-uuid";

export type QrProductDraft = {
  quantity: number;
  noteOptionIds: string[];
  bundleChoiceIds: string[];
};

export type QrOrderProductState = {
  drafts: Record<string, QrProductDraft>;
  editingLineIds: Record<string, string>;
  configuringProductId: string | null;
};

export const initialQrOrderProductState: QrOrderProductState = {
  drafts: {},
  editingLineIds: {},
  configuringProductId: null,
};

type QrOrderProductAction =
  | { type: "SET_QUANTITY"; productId: string; quantity: number }
  | {
      type: "SELECT_NOTE";
      productId: string;
      group: PublicMenuNoteGroup;
      optionId: string | null;
    }
  | {
      type: "SELECT_BUNDLE";
      productId: string;
      group: PublicMenuBundleChoiceGroup;
      choiceId: string | null;
    }
  | { type: "CLOSE"; productId: string }
  | { type: "EDIT_LINE"; line: QrCartLine }
  | { type: "SYNC_LINE_QUANTITY"; line: QrCartLine; quantity: number }
  | { type: "LOTTERY_PRODUCT"; productId: string }
  | {
      type: "RECONCILE";
      products: PublicMenuProduct[];
      cartLines: QrCartLine[];
    };

function withoutKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

export function reconcileQrOrderProductState(
  state: QrOrderProductState,
  products: PublicMenuProduct[],
  cartLines: QrCartLine[],
): QrOrderProductState {
  const draftLines = Object.entries(state.drafts).map(([productId, draft]) => ({
    id: `draft:${productId}`,
    productId,
    note: "",
    ...draft,
  }));
  const drafts = Object.fromEntries(
    prunePublicCartLinesForProducts(products, draftLines).map((line) => [line.productId, {
      quantity: line.quantity,
      noteOptionIds: line.noteOptionIds,
      bundleChoiceIds: line.bundleChoiceIds,
    }]),
  );
  const editingLineIds = Object.fromEntries(
    Object.entries(state.editingLineIds).filter(([, lineId]) => (
      cartLines.some((line) => line.id === lineId)
    )),
  );
  const invalidLines = cartLines.filter((line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    return product && (
      !noteSelectionIsValid(product.noteGroups, line.noteOptionIds)
      || !bundleSelectionIsValid(product.bundleChoiceGroups, line.bundleChoiceIds)
    );
  });
  for (const line of invalidLines) {
    if (!drafts[line.productId]) {
      drafts[line.productId] = {
        quantity: line.quantity,
        noteOptionIds: line.noteOptionIds,
        bundleChoiceIds: line.bundleChoiceIds,
      };
    }
    if (!editingLineIds[line.productId]) editingLineIds[line.productId] = line.id;
  }
  return {
    drafts,
    editingLineIds,
    configuringProductId: invalidLines[0]?.productId ?? null,
  };
}

export function qrOrderProductReducer(
  state: QrOrderProductState,
  action: QrOrderProductAction,
): QrOrderProductState {
  switch (action.type) {
    case "SET_QUANTITY": {
      if (action.quantity <= 0) {
        return {
          ...state,
          drafts: withoutKey(state.drafts, action.productId),
          configuringProductId: null,
        };
      }
      const draft = state.drafts[action.productId] ?? {
        quantity: 0,
        noteOptionIds: [],
        bundleChoiceIds: [],
      };
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.productId]: { ...draft, quantity: action.quantity },
        },
        configuringProductId: action.productId,
      };
    }
    case "SELECT_NOTE": {
      const draft = state.drafts[action.productId];
      if (!draft) return state;
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.productId]: {
            ...draft,
            noteOptionIds: toggleNoteOption(
              draft.noteOptionIds,
              action.group,
              action.optionId,
            ),
          },
        },
      };
    }
    case "SELECT_BUNDLE": {
      const draft = state.drafts[action.productId];
      if (!draft) return state;
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.productId]: {
            ...draft,
            bundleChoiceIds: toggleBundleChoice(
              draft.bundleChoiceIds,
              action.group,
              action.choiceId,
            ),
          },
        },
      };
    }
    case "CLOSE":
      return {
        drafts: withoutKey(state.drafts, action.productId),
        editingLineIds: withoutKey(state.editingLineIds, action.productId),
        configuringProductId: null,
      };
    case "EDIT_LINE":
      return {
        drafts: {
          ...state.drafts,
          [action.line.productId]: {
            quantity: action.line.quantity,
            noteOptionIds: action.line.noteOptionIds,
            bundleChoiceIds: action.line.bundleChoiceIds,
          },
        },
        editingLineIds: {
          ...state.editingLineIds,
          [action.line.productId]: action.line.id,
        },
        configuringProductId: action.line.productId,
      };
    case "SYNC_LINE_QUANTITY": {
      if (state.editingLineIds[action.line.productId] !== action.line.id) return state;
      if (action.quantity <= 0) {
        return {
          ...state,
          drafts: withoutKey(state.drafts, action.line.productId),
          editingLineIds: withoutKey(state.editingLineIds, action.line.productId),
        };
      }
      const draft = state.drafts[action.line.productId];
      return draft
        ? {
            ...state,
            drafts: {
              ...state.drafts,
              [action.line.productId]: { ...draft, quantity: action.quantity },
            },
          }
        : state;
    }
    case "LOTTERY_PRODUCT":
      return {
        drafts: {
          ...state.drafts,
          [action.productId]: {
            quantity: 1,
            noteOptionIds: state.drafts[action.productId]?.noteOptionIds ?? [],
            bundleChoiceIds: state.drafts[action.productId]?.bundleChoiceIds ?? [],
          },
        },
        editingLineIds: withoutKey(state.editingLineIds, action.productId),
        configuringProductId: action.productId,
      };
    case "RECONCILE":
      return reconcileQrOrderProductState(state, action.products, action.cartLines);
  }
}

export function commitQrProductDraft(input: {
  product: PublicMenuProduct;
  draft: QrProductDraft | undefined;
  editingLineId: string | undefined;
  cartLines: QrCartLine[];
  limits: QrCartLimits;
  createLineId?: () => string;
}) {
  if (!input.draft || input.draft.quantity <= 0) return { status: "NO_DRAFT" as const };
  if (
    !noteSelectionIsValid(input.product.noteGroups, input.draft.noteOptionIds)
    || !bundleSelectionIsValid(input.product.bundleChoiceGroups, input.draft.bundleChoiceIds)
  ) return { status: "INVALID_SELECTION" as const };
  const nextLine = {
    productId: input.product.id,
    quantity: input.draft.quantity,
    note: "",
    noteOptionIds: input.draft.noteOptionIds,
    bundleChoiceIds: input.draft.bundleChoiceIds,
  };
  const cartLines = input.editingLineId
    ? replaceQrCartLine(input.cartLines, input.editingLineId, nextLine, input.limits)
    : addQrCartLine(
        input.cartLines,
        nextLine,
        input.limits,
        input.createLineId ?? createWebUuid,
      );
  return cartLines
    ? { status: "COMMITTED" as const, cartLines }
    : { status: "QUANTITY_LIMIT" as const };
}

export function canUpdateQrProductDraftQuantity(input: {
  productId: string;
  currentQuantity: number;
  quantity: number;
  editingLineId: string | undefined;
  cartLines: QrCartLine[];
  limits: QrCartLimits;
}) {
  if (input.quantity <= input.currentQuantity) return true;
  const effectiveLines = input.editingLineId
    ? input.cartLines.filter((line) => line.id !== input.editingLineId)
    : input.cartLines;
  const distinctProducts = new Set(effectiveLines.map((line) => line.productId));
  return qrCartProductQuantity(effectiveLines, input.productId) + input.quantity
      <= input.limits.maxItemQuantity
    && qrCartTotalQuantity(effectiveLines) + input.quantity <= input.limits.maxTotalQuantity
    && (
      distinctProducts.has(input.productId)
      || distinctProducts.size < input.limits.maxUniqueProducts
    );
}

type UseQrOrderProductControllerInput = {
  products: PublicMenuProduct[];
  limits: QrCartLimits | null;
  activeOrderingMode: QrCartOrderingMode;
  scheduledPickupAt: string;
  orderingEnabled: boolean;
  cartLines: QrCartLine[];
  setCartLines: Dispatch<SetStateAction<QrCartLine[]>>;
  setCartOpen: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setTurnstileRequested: Dispatch<SetStateAction<boolean>>;
  quantityLimitMessage: string;
  requiredSelectionMessage(product: PublicMenuProduct): string;
  focusProduct(productId: string): void;
  createLineId?: () => string;
};

export function useQrOrderProductController(input: UseQrOrderProductControllerInput) {
  const [state, dispatch] = useReducer(qrOrderProductReducer, initialQrOrderProductState);
  const { focusProduct } = input;
  const visibleProducts = input.activeOrderingMode === "PREORDER"
    ? publicMenuProductsForPickup(input.products, input.scheduledPickupAt)
    : input.products;

  const cancelProductConfiguration = useCallback((productId: string) => {
    dispatch({ type: "CLOSE", productId });
    focusProduct(productId);
  }, [focusProduct]);

  function updateQuantity(productId: string, quantity: number) {
    if (!input.limits || !input.orderingEnabled) return;
    const product = visibleProducts.find((candidate) => candidate.id === productId);
    if (!product || product.isSoldOut) return;
    const configurable = product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
    if (!configurable) {
      const currentLine = input.cartLines.find((line) => line.productId === productId);
      const cartLines = currentLine
        ? updateQrCartLineQuantity(input.cartLines, currentLine.id, quantity, input.limits)
        : addQrCartLine(input.cartLines, {
            productId,
            quantity,
            note: "",
            noteOptionIds: [],
            bundleChoiceIds: [],
          }, input.limits, input.createLineId ?? createWebUuid);
      if (!cartLines) {
        input.setMessage(input.quantityLimitMessage);
        return;
      }
      input.setCartLines(cartLines);
      if (quantity > 0) input.setTurnstileRequested(true);
      input.setMessage("");
      return;
    }

    const draft = state.drafts[productId] ?? {
      quantity: 0,
      noteOptionIds: [],
      bundleChoiceIds: [],
    };
    const editingLineId = state.editingLineIds[productId];
    if (!canUpdateQrProductDraftQuantity({
      productId,
      currentQuantity: draft.quantity,
      quantity,
      editingLineId,
      cartLines: input.cartLines,
      limits: input.limits,
    })) {
      input.setMessage(input.quantityLimitMessage);
      return;
    }
    input.setMessage("");
    dispatch({ type: "SET_QUANTITY", productId, quantity });
  }

  function selectNoteOption(
    productId: string,
    group: PublicMenuNoteGroup,
    optionId: string | null,
  ) {
    if (!input.orderingEnabled) return;
    input.setMessage("");
    dispatch({ type: "SELECT_NOTE", productId, group, optionId });
  }

  function selectBundleChoice(
    productId: string,
    group: PublicMenuBundleChoiceGroup,
    choiceId: string | null,
  ) {
    if (!input.orderingEnabled) return;
    input.setMessage("");
    dispatch({ type: "SELECT_BUNDLE", productId, group, choiceId });
  }

  function addProductDraft(product: PublicMenuProduct) {
    if (!input.limits || !input.orderingEnabled || product.isSoldOut) return;
    const result = commitQrProductDraft({
      product,
      draft: state.drafts[product.id],
      editingLineId: state.editingLineIds[product.id],
      cartLines: input.cartLines,
      limits: input.limits,
      createLineId: input.createLineId,
    });
    if (result.status === "NO_DRAFT") return;
    if (result.status === "INVALID_SELECTION") {
      input.setMessage(input.requiredSelectionMessage(product));
      return;
    }
    if (result.status === "QUANTITY_LIMIT") {
      input.setMessage(input.quantityLimitMessage);
      return;
    }
    input.setCartLines(result.cartLines);
    dispatch({ type: "CLOSE", productId: product.id });
    input.focusProduct(product.id);
    input.setTurnstileRequested(true);
    input.setMessage("");
  }

  function changeCartLineQuantity(lineId: string, quantity: number) {
    if (!input.limits || !input.orderingEnabled) return;
    const cartLines = updateQrCartLineQuantity(input.cartLines, lineId, quantity, input.limits);
    if (!cartLines) {
      input.setMessage(input.quantityLimitMessage);
      return;
    }
    input.setCartLines(cartLines);
    const line = input.cartLines.find((candidate) => candidate.id === lineId);
    if (line) dispatch({ type: "SYNC_LINE_QUANTITY", line, quantity });
    input.setMessage("");
  }

  function editCartLine(line: QrCartLine) {
    dispatch({ type: "EDIT_LINE", line });
    input.setCartOpen(false);
  }

  function reconcileAvailableProducts(
    products: PublicMenuProduct[],
    cartLines: QrCartLine[],
  ) {
    dispatch({ type: "RECONCILE", products, cartLines });
  }

  function configureLotteryProduct(productId: string) {
    dispatch({ type: "LOTTERY_PRODUCT", productId });
  }

  return {
    productDrafts: state.drafts,
    editingLineIds: state.editingLineIds,
    configuringProductId: state.configuringProductId,
    updateQuantity,
    selectNoteOption,
    selectBundleChoice,
    addProductDraft,
    changeCartLineQuantity,
    editCartLine,
    cancelProductConfiguration,
    reconcileAvailableProducts,
    configureLotteryProduct,
  };
}
