import { createPublicOrderOperationId } from "@/lib/public-order-client";
import { resolvePublicOrderingMode } from "@/lib/public-order-session-retry";
import {
  restoreQrCartDraft,
  type QrCartLine,
  type QrCartOrderingMode,
} from "@/lib/qr-cart";
import {
  prunePublicCartLinesForProducts,
  publicMenuProductsForPickup,
} from "@/lib/public-menu-availability";
import type { PublicMenu } from "@/lib/public-menu-types";
import { createWebUuid } from "@/lib/web-uuid";

export type QrOrderEntryChannel = "QR" | "SHARED_LINK";

export type QrOrderSession = PublicMenu & {
  orderSessionToken: string;
  expiresAt: string;
};

export type QrSessionIdentity = {
  sessionRequestId: string;
  operationId: string;
};

export type QrCheckoutIdentity = {
  key: string;
  clientOrderId: string;
  turnstileIdempotencyKey: string;
  operationId: string;
  fingerprint: string;
};

export type QrSelectedItem = {
  productId: string;
  quantity: number;
  note: string;
  noteOptionIds: string[];
  bundleChoiceIds: string[];
};

export type QrCartDraftInput = {
  orderingMode: QrCartOrderingMode;
  scheduledPickupAt: string;
  customerName: string;
  customerNote: string;
  customerPhone: string;
  deliveryAddress: string;
  lines: QrCartLine[];
};

export type QrCheckoutFingerprintInput = {
  orderingMode: QrCartOrderingMode;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  customerNote: string;
  scheduledPickupAt: string;
  lotteryDrawId: string | null;
  selectedItems: QrSelectedItem[];
  waitAcknowledged: boolean;
};

export function usableQrInitialMenu(
  entryChannel: QrOrderEntryChannel,
  initialMenu: PublicMenu | null,
) {
  return entryChannel === "QR" && initialMenu?.orderingMode !== "DEFAULT"
    ? null
    : initialMenu;
}

export function qrEntryAllowsOrderingMode(
  entryChannel: QrOrderEntryChannel,
  orderingMode: QrCartOrderingMode,
) {
  return entryChannel !== "QR" || orderingMode === "DEFAULT";
}

export function normalizeQrOrderSession(
  rawOrderSession: QrOrderSession,
  fallbackOrderingMode: QrCartOrderingMode,
): QrOrderSession {
  const orderingMode = resolvePublicOrderingMode(
    rawOrderSession.orderingMode,
    fallbackOrderingMode,
  );
  return {
    ...rawOrderSession,
    orderingMode,
    preorderSlots: Array.isArray(rawOrderSession.preorderSlots)
      ? rawOrderSession.preorderSlots
      : [],
    lotteryEnabled: orderingMode === "DEFAULT" && rawOrderSession.lotteryEnabled === true,
    products: rawOrderSession.products.map((product) => ({
      ...product,
      kind: product.kind === "BUNDLE" ? "BUNDLE" : "SINGLE",
      bundleChoiceGroups: Array.isArray(product.bundleChoiceGroups)
        ? product.bundleChoiceGroups
        : [],
      isBestSeller: product.isBestSeller === true,
      isOrderDiscountEligible: product.isOrderDiscountEligible !== false,
      rank: typeof product.rank === "number" ? product.rank : null,
    })),
  };
}

export function restoreQrOrderSessionCart(input: {
  raw: string | null;
  session: QrOrderSession;
  currentScheduledPickupAt: string;
  now?: number;
}) {
  const restoredDraft = restoreQrCartDraft(
    input.raw,
    input.session.products,
    input.session.limits,
    input.now,
    { orderingMode: input.session.orderingMode },
  );
  const restoredScheduledPickupAt = restoredDraft?.orderingMode === input.session.orderingMode
    && input.session.preorderSlots.includes(restoredDraft.scheduledPickupAt)
    ? restoredDraft.scheduledPickupAt
    : "";
  const currentScheduledPickupAt = input.session.preorderSlots.includes(
    input.currentScheduledPickupAt,
  )
    ? input.currentScheduledPickupAt
    : "";
  const scheduledPickupAt = input.session.orderingMode === "PREORDER"
    ? restoredScheduledPickupAt || currentScheduledPickupAt
    : input.session.orderingMode === "DELIVERY"
      ? restoredScheduledPickupAt || currentScheduledPickupAt
      : "";
  const draftScheduledPickupAt = input.session.orderingMode === "PREORDER"
    ? scheduledPickupAt || (input.session.preorderSlots[0] ?? "")
    : scheduledPickupAt;
  const restorableProducts = input.session.orderingMode === "PREORDER"
    ? publicMenuProductsForPickup(input.session.products, scheduledPickupAt)
    : input.session.products;
  const lines = restoredDraft
    ? prunePublicCartLinesForProducts(restorableProducts, restoredDraft.lines)
    : [];

  return {
    restored: restoredDraft !== null,
    scheduledPickupAt,
    draftScheduledPickupAt,
    lines,
    customerName: restoredDraft?.customerName ?? "",
    customerNote: restoredDraft?.customerNote ?? "",
    customerPhone: restoredDraft?.customerPhone ?? "",
    deliveryAddress: restoredDraft?.deliveryAddress ?? "",
  };
}

export function ensureQrSessionIdentity(
  sessionRequestId: string | null,
  operationId: string | null,
  createUuid: () => string = createWebUuid,
  createOperationId: () => string = createPublicOrderOperationId,
): QrSessionIdentity {
  return {
    sessionRequestId: sessionRequestId ?? createUuid(),
    operationId: operationId ?? createOperationId(),
  };
}

export function buildQrCartDraft(input: QrCartDraftInput): QrCartDraftInput | null {
  const hasDraft = input.lines.length > 0
    || input.customerName.length > 0
    || input.customerNote.length > 0
    || input.customerPhone.length > 0
    || input.deliveryAddress.length > 0
    || (input.orderingMode !== "DEFAULT" && input.scheduledPickupAt.length > 0);
  if (!hasDraft) return null;
  return {
    ...input,
    scheduledPickupAt: input.orderingMode === "DEFAULT" ? "" : input.scheduledPickupAt,
  };
}

export function createQrCheckoutFingerprint(input: QrCheckoutFingerprintInput) {
  return JSON.stringify(input);
}

export function resolveQrCheckoutIdentity(
  current: QrCheckoutIdentity | null,
  fingerprint: string,
  createUuid: () => string = createWebUuid,
  createOperationId: () => string = createPublicOrderOperationId,
): QrCheckoutIdentity {
  if (current?.fingerprint === fingerprint) return current;
  return {
    key: createUuid(),
    clientOrderId: createUuid(),
    turnstileIdempotencyKey: createUuid(),
    operationId: createOperationId(),
    fingerprint,
  };
}

export function buildQrPublicOrderRequest(input: {
  qrToken: string;
  orderSessionToken: string;
  deviceId: string;
  identity: QrCheckoutIdentity;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  customerNote: string;
  waitAcknowledged: boolean;
  orderingMode: QrCartOrderingMode;
  scheduledPickupAt: string;
  entryChannel: QrOrderEntryChannel;
  lotteryDrawId: string | null;
  items: QrSelectedItem[];
  turnstileToken: string;
}) {
  return {
    body: {
      qrToken: input.qrToken,
      orderSessionToken: input.orderSessionToken,
      deviceId: input.deviceId,
      idempotencyKey: input.identity.key,
      clientOrderId: input.identity.clientOrderId,
      turnstileIdempotencyKey: input.identity.turnstileIdempotencyKey,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      deliveryAddress: input.deliveryAddress,
      customerNote: input.customerNote,
      waitAcknowledged: input.waitAcknowledged,
      orderingMode: input.orderingMode,
      scheduledPickupAt: input.entryChannel === "SHARED_LINK"
        ? input.scheduledPickupAt || null
        : null,
      lotteryDrawId: input.lotteryDrawId,
      items: input.items,
      turnstileToken: input.turnstileToken,
    },
    operationId: input.identity.operationId,
  };
}
