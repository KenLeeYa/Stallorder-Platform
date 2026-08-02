export function nextProductNoteSortOrder(items: ReadonlyArray<{ sortOrder: number }>) {
  return items.reduce((highest, item) => Math.max(highest, item.sortOrder), 0) + 1;
}
