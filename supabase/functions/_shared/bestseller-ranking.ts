export const BEST_SELLER_LIMIT = 3;

export type BestSellerRankRow = {
  product_id: string;
  rank: number;
};

type RankableProduct = {
  id: string;
  category: string;
};

export function applyBestSellerRanking<T extends RankableProduct>(
  products: readonly T[],
  rows: readonly BestSellerRankRow[],
): Array<T & { rank: number | null; isBestSeller: boolean }> {
  const ranks = new Map(
    rows
      .filter((row) => Number.isInteger(row.rank) && row.rank >= 1 && row.rank <= BEST_SELLER_LIMIT)
      .map((row) => [row.product_id, row.rank]),
  );
  const categoryOrder = new Map<string, number>();
  for (const product of products) {
    if (!categoryOrder.has(product.category)) categoryOrder.set(product.category, categoryOrder.size);
  }

  return products
    .map((product, originalIndex) => {
      const rank = ranks.get(product.id) ?? null;
      return { product, rank, originalIndex };
    })
    .sort((left, right) => (
      (categoryOrder.get(left.product.category) ?? 0) - (categoryOrder.get(right.product.category) ?? 0)
      || (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
      || left.originalIndex - right.originalIndex
    ))
    .map(({ product, rank }) => ({ ...product, rank, isBestSeller: rank !== null }));
}
