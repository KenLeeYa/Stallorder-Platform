import type { PublicMenuProduct } from "@/lib/public-menu-types";
import type { QrCartLine } from "@/lib/qr-cart";
import {
  filterPublicMenuProductsForTime,
  filterPublicMenuProductsForTimeWindow,
} from "../../supabase/functions/_shared/public-menu-availability";

export function publicMenuProductsForPickup(
  products: readonly PublicMenuProduct[],
  scheduledPickupAt: string,
) {
  return filterPublicMenuProductsForTime(products, scheduledPickupAt);
}

export function publicMenuProductsForPickupWindow(
  products: readonly PublicMenuProduct[],
  preorderSlots: readonly string[],
) {
  return filterPublicMenuProductsForTimeWindow(products, preorderSlots);
}

export function publicMenuProductsVisibleForOrdering(
  products: readonly PublicMenuProduct[],
) {
  return products.filter((product) => !product.isSoldOut);
}

export function prunePublicCartForProducts(
  products: readonly PublicMenuProduct[],
  cart: {
    quantities: Readonly<Record<string, number>>;
    noteSelections: Readonly<Record<string, string[]>>;
    bundleSelections: Readonly<Record<string, string[]>>;
  },
) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const quantities: Record<string, number> = {};
  const noteSelections: Record<string, string[]> = {};
  const bundleSelections: Record<string, string[]> = {};

  for (const [productId, quantity] of Object.entries(cart.quantities)) {
    const product = productsById.get(productId);
    if (!product || product.isSoldOut || quantity <= 0) continue;
    quantities[productId] = quantity;

    const allowedNoteIds = new Set(product.noteGroups.flatMap((group) => (
      group.options.map((option) => option.id)
    )));
    const nextNoteSelections = (cart.noteSelections[productId] ?? []).filter((id) => (
      allowedNoteIds.has(id)
    ));
    if (nextNoteSelections.length > 0) noteSelections[productId] = nextNoteSelections;

    const allowedBundleChoiceIds = new Set((product.bundleChoiceGroups ?? []).flatMap((group) => (
      group.options.map((option) => option.id)
    )));
    const nextBundleSelections = (cart.bundleSelections[productId] ?? []).filter((id) => (
      allowedBundleChoiceIds.has(id)
    ));
    if (nextBundleSelections.length > 0) bundleSelections[productId] = nextBundleSelections;
  }

  return { quantities, noteSelections, bundleSelections };
}

export function prunePublicCartLinesForProducts(
  products: readonly PublicMenuProduct[],
  lines: readonly QrCartLine[],
) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return lines.flatMap((line) => {
    const product = productsById.get(line.productId);
    if (!product || product.isSoldOut || line.quantity <= 0) return [];
    const allowedNoteIds = new Set(product.noteGroups.flatMap((group) => (
      group.options.map((option) => option.id)
    )));
    const allowedBundleChoiceIds = new Set((product.bundleChoiceGroups ?? []).flatMap((group) => (
      group.options.map((option) => option.id)
    )));
    return [{
      ...line,
      noteOptionIds: line.noteOptionIds.filter((id) => allowedNoteIds.has(id)),
      bundleChoiceIds: line.bundleChoiceIds.filter((id) => allowedBundleChoiceIds.has(id)),
    }];
  });
}
