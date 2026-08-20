import { buildQrCartDraft } from "@/components/qr-order-flow-orchestration";
import {
  qrCartStorageKey,
  serializeQrCartDraft,
  type QrCartLine,
  type QrCartOrderingMode,
} from "@/lib/qr-cart";

type QrCartDraftStorage = Pick<Storage, "setItem" | "removeItem">;

export type QrOrderCartPersistenceInput = {
  sessionReady: boolean;
  cartReady: boolean;
  qrToken: string;
  orderingMode: QrCartOrderingMode;
  scheduledPickupAt: string;
  customerName: string;
  customerNote: string;
  customerPhone: string;
  deliveryAddress: string;
  lines: QrCartLine[];
  now?: number;
};

export function persistQrOrderCartDraft(
  input: QrOrderCartPersistenceInput,
  loadStorage: () => QrCartDraftStorage,
) {
  if (!input.sessionReady || !input.cartReady) return;
  try {
    const storage = loadStorage();
    const draft = buildQrCartDraft({
      orderingMode: input.orderingMode,
      scheduledPickupAt: input.scheduledPickupAt,
      customerName: input.customerName,
      customerNote: input.customerNote,
      customerPhone: input.customerPhone,
      deliveryAddress: input.deliveryAddress,
      lines: input.lines,
    });
    const storageKey = qrCartStorageKey(input.qrToken, input.orderingMode);
    if (draft) {
      storage.setItem(storageKey, serializeQrCartDraft(draft, input.now));
    } else {
      storage.removeItem(storageKey);
    }
  } catch {
    // Restricted browser storage must not block ordering.
  }
}
