import type { PublicMenuProduct } from "@/lib/public-menu-types";

export const MAX_CHECKOUT_UPSELL_PRODUCTS = 6;

export function resolveCheckoutUpsellCandidates({
  products,
  configuredProductIds,
  cartProductIds,
}: {
  products: PublicMenuProduct[];
  configuredProductIds: string[];
  cartProductIds: ReadonlySet<string>;
}) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return configuredProductIds.flatMap((productId) => {
    const product = productsById.get(productId);
    return product && !product.isSoldOut && !cartProductIds.has(productId) ? [product] : [];
  });
}
