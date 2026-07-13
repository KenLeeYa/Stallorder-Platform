export function effectiveProductPrice(defaultPrice: number, priceOverride: number | null) {
  return priceOverride ?? defaultPrice;
}
