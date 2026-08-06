export type OrderItemLimits = {
  maxItemQuantity: number;
  maxUniqueProducts: number;
  maxTotalQuantity: number;
  maxNoteLength: number;
};

export type LimitedOrderItem = {
  productId: string;
  quantity: number;
  note: string;
};

export function orderItemsExceedLimits(
  items: readonly LimitedOrderItem[],
  orderNote: string,
  limits: OrderItemLimits,
) {
  const quantitiesByProduct = new Map<string, number>();
  for (const item of items) {
    quantitiesByProduct.set(
      item.productId,
      (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity,
    );
  }
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  return quantitiesByProduct.size > limits.maxUniqueProducts
    || totalQuantity > limits.maxTotalQuantity
    || [...quantitiesByProduct.values()].some((quantity) => quantity > limits.maxItemQuantity)
    || items.some((item) => item.note.length > limits.maxNoteLength)
    || orderNote.length > limits.maxNoteLength;
}
