export function isOrderStockError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("PRODUCT_STOCK_INSUFFICIENT");
}
