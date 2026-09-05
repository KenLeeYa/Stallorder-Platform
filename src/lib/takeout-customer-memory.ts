const TAKEOUT_CUSTOMER_KEY_PREFIX = "stallorder_takeout_customer:v1:";
const TAKEOUT_CUSTOMER_TTL_MS = 180 * 24 * 60 * 60 * 1_000;

type CustomerMemoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type TakeoutCustomerMemory = {
  customerName: string;
  customerPhone: string;
  expiresAt: number;
};

export function persistTakeoutCustomerMemory(
  storage: CustomerMemoryStorage,
  stallSlug: string,
  input: Pick<TakeoutCustomerMemory, "customerName" | "customerPhone">,
  now = Date.now(),
) {
  const customerName = input.customerName.trim().slice(0, 50);
  const customerPhone = input.customerPhone.trim().slice(0, 30);
  if (!stallSlug || (!customerName && !customerPhone)) return;
  try {
    storage.setItem(storageKey(stallSlug), JSON.stringify({
      customerName,
      customerPhone,
      expiresAt: now + TAKEOUT_CUSTOMER_TTL_MS,
    }));
  } catch {
    // Restricted browser storage must not block checkout.
  }
}

export function readTakeoutCustomerMemory(
  storage: CustomerMemoryStorage,
  stallSlug: string,
  now = Date.now(),
): TakeoutCustomerMemory | null {
  if (!stallSlug) return null;
  try {
    const key = storageKey(stallSlug);
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TakeoutCustomerMemory>;
    if (
      typeof value.customerName !== "string"
      || typeof value.customerPhone !== "string"
      || typeof value.expiresAt !== "number"
      || !Number.isFinite(value.expiresAt)
      || value.expiresAt <= now
    ) {
      storage.removeItem(key);
      return null;
    }
    return {
      customerName: value.customerName.slice(0, 50),
      customerPhone: value.customerPhone.slice(0, 30),
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

function storageKey(stallSlug: string) {
  return `${TAKEOUT_CUSTOMER_KEY_PREFIX}${encodeURIComponent(stallSlug)}`;
}
