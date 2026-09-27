type OrderStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// MINI identities come from the server session, never query strings or stored drafts.
// An unscoped browser draft is not evidence that it belongs to a signed-in customer.
export function createQrOrderStorage(
  loadStorage: () => OrderStorage,
  scope?: { customerId: string; qrToken: string },
): OrderStorage {
  const key = (value: string) => scope
    ? `stallorder_mini_order:v1:${encodeURIComponent(scope.customerId)}:${encodeURIComponent(scope.qrToken)}:${value}`
    : value;
  return {
    getItem(value) { try { return loadStorage().getItem(key(value)); } catch { return null; } },
    setItem(value, data) { try { loadStorage().setItem(key(value), data); } catch { /* Storage is optional. */ } },
    removeItem(value) { try { loadStorage().removeItem(key(value)); } catch { /* Storage is optional. */ } },
  };
}
