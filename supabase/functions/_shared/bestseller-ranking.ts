export const BEST_SELLER_LIMIT = 3;

export type BestSellerRankRow = {
  product_id: string;
  rank: number;
};

type RankableProduct = {
  id: string;
  category: string;
  group?: string | null;
};

function rankingSection(product: RankableProduct) {
  return `${product.category}\u0000${product.group ?? "__UNGROUPED__"}`;
}

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
    const section = rankingSection(product);
    if (!categoryOrder.has(section)) categoryOrder.set(section, categoryOrder.size);
  }

  return products
    .map((product, originalIndex) => {
      const rank = ranks.get(product.id) ?? null;
      return { product, rank, originalIndex };
    })
    .sort((left, right) => (
      (categoryOrder.get(rankingSection(left.product)) ?? 0)
        - (categoryOrder.get(rankingSection(right.product)) ?? 0)
      || (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
      || left.originalIndex - right.originalIndex
    ))
    .map(({ product, rank }) => ({ ...product, rank, isBestSeller: rank !== null }));
}
