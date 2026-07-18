export const QR_CART_TTL_MS = 24 * 60 * 60 * 1000;

export type QrCartDraft = {
  savedAt: number;
  customerName: string;
  customerNote: string;
  customerPhone?: string;
  deliveryAddress?: string;
  quantities: Record<string, number>;
  noteSelections: Record<string, string[]>;
};

type CatalogProduct = {
  id: string;
  noteGroups: Array<{ options: Array<{ id: string }> }>;
};

type CartLimits = {
  maxItemQuantity: number;
  maxUniqueProducts: number;
  maxTotalQuantity: number;
  maxNoteLength: number;
};

export function qrCartStorageKey(qrToken: string, scope: "DEFAULT" | "DELIVERY" = "DEFAULT") {
  const suffix = scope === "DELIVERY" ? ":delivery" : "";
  return `stallorder_qr_cart:${encodeURIComponent(qrToken)}${suffix}`;
}

export function serializeQrCartDraft(draft: Omit<QrCartDraft, "savedAt">, now = Date.now()) {
  return JSON.stringify({ ...draft, savedAt: now });
}

export function restoreQrCartDraft(
  raw: string | null,
  products: CatalogProduct[],
  limits: CartLimits,
  now = Date.now(),
): QrCartDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Number.isFinite(parsed.savedAt)
    || now - Number(parsed.savedAt) > QR_CART_TTL_MS
    || now < Number(parsed.savedAt)) return null;

  const rawQuantities = isRecord(parsed.quantities) ? parsed.quantities : {};
  const rawSelections = isRecord(parsed.noteSelections) ? parsed.noteSelections : {};
  const quantities: Record<string, number> = {};
  const noteSelections: Record<string, string[]> = {};
  let totalQuantity = 0;

  for (const product of products) {
    if (Object.keys(quantities).length >= limits.maxUniqueProducts) break;
    const requested = Number(rawQuantities[product.id]);
    if (!Number.isInteger(requested) || requested <= 0) continue;
    const quantity = Math.min(requested, limits.maxItemQuantity, limits.maxTotalQuantity - totalQuantity);
    if (quantity <= 0) break;
    quantities[product.id] = quantity;
    totalQuantity += quantity;

    const allowedOptions = new Set(product.noteGroups.flatMap((group) => group.options.map((option) => option.id)));
    const rawSelected = rawSelections[product.id];
    const selected = Array.isArray(rawSelected)
      ? [...new Set(rawSelected.filter((value: unknown): value is string => typeof value === "string" && allowedOptions.has(value)))]
      : [];
    if (selected.length > 0) noteSelections[product.id] = selected;
  }

  const customerName = typeof parsed.customerName === "string" ? parsed.customerName.slice(0, 50) : "";
  const customerNote = typeof parsed.customerNote === "string"
    ? parsed.customerNote.slice(0, limits.maxNoteLength)
    : "";
  const customerPhone = typeof parsed.customerPhone === "string" ? parsed.customerPhone.slice(0, 30) : "";
  const deliveryAddress = typeof parsed.deliveryAddress === "string" ? parsed.deliveryAddress.slice(0, 300) : "";
  if (Object.keys(quantities).length === 0 && !customerName && !customerNote && !customerPhone && !deliveryAddress) return null;

  return {
    savedAt: Number(parsed.savedAt),
    customerName,
    customerNote,
    customerPhone,
    deliveryAddress,
    quantities,
    noteSelections,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
