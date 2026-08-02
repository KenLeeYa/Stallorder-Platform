export const QR_CART_TTL_MS = 24 * 60 * 60 * 1000;
export const QR_CART_VERSION = 2;
export const QR_CART_MAX_LINES = 100;

export type QrCartLine = {
  id: string;
  productId: string;
  quantity: number;
  note: string;
  noteOptionIds: string[];
  bundleChoiceIds: string[];
};

export type QrCartDraft = {
  version: typeof QR_CART_VERSION;
  savedAt: number;
  customerName: string;
  customerNote: string;
  customerPhone?: string;
  deliveryAddress?: string;
  lines: QrCartLine[];
};

type CatalogProduct = {
  id: string;
  noteGroups: Array<{ options: Array<{ id: string }> }>;
  bundleChoiceGroups?: Array<{ options: Array<{ id: string }> }>;
};

export type QrCartLimits = {
  maxItemQuantity: number;
  maxUniqueProducts: number;
  maxTotalQuantity: number;
  maxNoteLength: number;
};

type LegacyQrCartDraft = {
  quantities: Record<string, unknown>;
  noteSelections: Record<string, unknown>;
  bundleSelections: Record<string, unknown>;
};

export function qrCartStorageKey(qrToken: string, scope: "DEFAULT" | "DELIVERY" | "PREORDER" = "DEFAULT") {
  const suffix = scope === "DEFAULT" ? "" : `:${scope.toLowerCase()}`;
  return `stallorder_qr_cart:${encodeURIComponent(qrToken)}${suffix}`;
}

export function qrCartLineKey(line: Pick<QrCartLine, "productId" | "note" | "noteOptionIds" | "bundleChoiceIds">) {
  return JSON.stringify([
    line.productId,
    line.note.trim(),
    [...line.noteOptionIds].sort(),
    [...line.bundleChoiceIds].sort(),
  ]);
}

export function qrCartTotalQuantity(lines: readonly QrCartLine[]) {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function qrCartProductQuantity(lines: readonly QrCartLine[], productId: string) {
  return lines.reduce((sum, line) => line.productId === productId ? sum + line.quantity : sum, 0);
}

export function addQrCartLine(
  lines: readonly QrCartLine[],
  input: Omit<QrCartLine, "id">,
  limits: QrCartLimits,
  createId: () => string,
): QrCartLine[] | null {
  const quantity = Math.trunc(input.quantity);
  if (quantity < 1) return null;
  const productQuantity = qrCartProductQuantity(lines, input.productId);
  if (productQuantity + quantity > limits.maxItemQuantity) return null;
  if (qrCartTotalQuantity(lines) + quantity > limits.maxTotalQuantity) return null;

  const existingIndex = lines.findIndex((line) => qrCartLineKey(line) === qrCartLineKey(input));
  if (existingIndex >= 0) {
    return lines.map((line, index) => index === existingIndex
      ? { ...line, quantity: line.quantity + quantity }
      : line);
  }

  const distinctProducts = new Set(lines.map((line) => line.productId));
  if (!distinctProducts.has(input.productId) && distinctProducts.size >= limits.maxUniqueProducts) return null;
  if (lines.length >= QR_CART_MAX_LINES) return null;
  return [...lines, { ...input, id: createId() }];
}

export function updateQrCartLineQuantity(
  lines: readonly QrCartLine[],
  lineId: string,
  quantity: number,
  limits: QrCartLimits,
): QrCartLine[] | null {
  const current = lines.find((line) => line.id === lineId);
  if (!current) return null;
  if (quantity <= 0) return lines.filter((line) => line.id !== lineId);
  const nextQuantity = Math.trunc(quantity);
  const otherLines = lines.filter((line) => line.id !== lineId);
  if (qrCartProductQuantity(otherLines, current.productId) + nextQuantity > limits.maxItemQuantity) return null;
  if (qrCartTotalQuantity(otherLines) + nextQuantity > limits.maxTotalQuantity) return null;
  return lines.map((line) => line.id === lineId ? { ...line, quantity: nextQuantity } : line);
}

export function serializeQrCartDraft(draft: Omit<QrCartDraft, "version" | "savedAt">, now = Date.now()) {
  return JSON.stringify({ ...draft, version: QR_CART_VERSION, savedAt: now });
}

export function restoreQrCartDraft(
  raw: string | null,
  products: CatalogProduct[],
  limits: QrCartLimits,
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

  const productsById = new Map(products.map((product) => [product.id, product]));
  const rawLines = parsed.version === QR_CART_VERSION && Array.isArray(parsed.lines)
    ? parsed.lines
    : legacyLines(parsed, products);
  const lines: QrCartLine[] = [];
  const usedIds = new Set<string>();

  for (const [index, rawLine] of rawLines.entries()) {
    if (lines.length >= QR_CART_MAX_LINES || !isRecord(rawLine)) break;
    const productId = typeof rawLine.productId === "string" ? rawLine.productId : "";
    const product = productsById.get(productId);
    const requested = Number(rawLine.quantity);
    if (!product || !Number.isInteger(requested) || requested <= 0) continue;

    const allowedNoteIds = new Set(product.noteGroups.flatMap((group) => group.options.map((option) => option.id)));
    const allowedBundleIds = new Set((product.bundleChoiceGroups ?? []).flatMap((group) => group.options.map((option) => option.id)));
    const noteOptionIds = sanitizedIds(rawLine.noteOptionIds, allowedNoteIds);
    const bundleChoiceIds = sanitizedIds(rawLine.bundleChoiceIds, allowedBundleIds);
    const note = typeof rawLine.note === "string" ? rawLine.note.slice(0, limits.maxNoteLength) : "";
    const productRemaining = limits.maxItemQuantity - qrCartProductQuantity(lines, productId);
    const totalRemaining = limits.maxTotalQuantity - qrCartTotalQuantity(lines);
    const quantity = Math.min(requested, productRemaining, totalRemaining);
    if (quantity <= 0) continue;

    const distinctProducts = new Set(lines.map((line) => line.productId));
    if (!distinctProducts.has(productId) && distinctProducts.size >= limits.maxUniqueProducts) continue;
    const preferredId = typeof rawLine.id === "string" && rawLine.id.trim()
      ? rawLine.id.trim()
      : `restored:${index}:${productId}`;
    const id = usedIds.has(preferredId) ? `${preferredId}:${index}` : preferredId;
    const nextLine = { id, productId, quantity, note, noteOptionIds, bundleChoiceIds };
    const existingIndex = lines.findIndex((line) => qrCartLineKey(line) === qrCartLineKey(nextLine));
    if (existingIndex >= 0) {
      lines[existingIndex] = {
        ...lines[existingIndex],
        quantity: lines[existingIndex].quantity + quantity,
      };
    } else {
      usedIds.add(id);
      lines.push(nextLine);
    }
  }

  const customerName = typeof parsed.customerName === "string" ? parsed.customerName.slice(0, 50) : "";
  const customerNote = typeof parsed.customerNote === "string"
    ? parsed.customerNote.slice(0, limits.maxNoteLength)
    : "";
  const customerPhone = typeof parsed.customerPhone === "string" ? parsed.customerPhone.slice(0, 30) : "";
  const deliveryAddress = typeof parsed.deliveryAddress === "string" ? parsed.deliveryAddress.slice(0, 300) : "";
  if (lines.length === 0 && !customerName && !customerNote && !customerPhone && !deliveryAddress) return null;

  return {
    version: QR_CART_VERSION,
    savedAt: Number(parsed.savedAt),
    customerName,
    customerNote,
    customerPhone,
    deliveryAddress,
    lines,
  };
}

function legacyLines(parsed: Record<string, unknown>, products: CatalogProduct[]) {
  const legacy: LegacyQrCartDraft = {
    quantities: isRecord(parsed.quantities) ? parsed.quantities : {},
    noteSelections: isRecord(parsed.noteSelections) ? parsed.noteSelections : {},
    bundleSelections: isRecord(parsed.bundleSelections) ? parsed.bundleSelections : {},
  };
  return products.map((product) => ({
    id: `legacy:${product.id}`,
    productId: product.id,
    quantity: legacy.quantities[product.id],
    note: "",
    noteOptionIds: legacy.noteSelections[product.id],
    bundleChoiceIds: legacy.bundleSelections[product.id],
  }));
}

function sanitizedIds(value: unknown, allowed: ReadonlySet<string>) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && allowed.has(entry)))]
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
