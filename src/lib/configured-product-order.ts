export const UNGROUPED_PRODUCT_SORT_ORDER = 10_001;

export type ConfiguredProductOrder = {
  categorySortOrder: number;
  groupSortOrder: number;
  productSortOrder: number;
  stallProductSortOrder: number;
  name: string;
  id: string;
};

export function compareConfiguredProductOrder(
  left: ConfiguredProductOrder,
  right: ConfiguredProductOrder,
) {
  return left.categorySortOrder - right.categorySortOrder
    || left.groupSortOrder - right.groupSortOrder
    || left.stallProductSortOrder - right.stallProductSortOrder
    || left.productSortOrder - right.productSortOrder
    || left.name.localeCompare(right.name, "zh-Hant-TW")
    || left.id.localeCompare(right.id);
}
