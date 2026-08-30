import {
  createPublicOrderOperationId,
  parseEdgeResponse,
  publicOrderCircuitHeaders,
  requestPublicOrder,
  type PublicAvailabilityStatus,
} from "@/lib/public-order-client";
import {
  invoiceBuyerSelectionSchema,
  type InvoiceBuyerSelection,
} from "@/lib/e-invoice-checkout-contract";
import type { QrOrderSessionController } from "@/components/qr-order-session-controller";
import {
  buildQrPublicOrderRequest,
  createQrCheckoutFingerprint,
  type QrOrderEntryChannel,
  type QrOrderSession,
  type QrSelectedItem,
} from "@/components/qr-order-flow-orchestration";
import { bundleSelectionIsValid } from "@/lib/product-bundle-selection";
import { noteSelectionIsValid } from "@/lib/product-note-selection";
import type {
  QrCartLine,
  QrCartOrderingMode,
} from "@/lib/qr-cart";
import { sessionCountdownPhase } from "@/lib/session-countdown";
import type { PublicMenuProduct } from "@/lib/public-menu-types";

export type QrOrderCheckoutTransport = (
  body: Record<string, unknown>,
  operationId: string,
) => Promise<{
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}>;

type QrOrderCheckoutInput = {
  body: Record<string, unknown>;
  operationId: string;
  networkError: string;
  localizeError: (code: string) => string;
  requestOrder?: QrOrderCheckoutTransport;
  onMessage: (message: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
  onWaitAcknowledgmentRequired: (capacity: {
    estimatedWaitMinMinutes: unknown;
    estimatedWaitMaxMinutes: unknown;
  }) => void;
  onInvalidTurnstile: () => void;
  clearPersistedCart: () => void;
  navigateToOrder: (trackingToken: string) => void;
  afterOrderCreated?: (trackingToken: string) => Promise<string | null>;
};

export type QrCheckoutBlockerInput = {
  orderingAvailability: PublicAvailabilityStatus | "CHECKING";
  totalQuantity: number;
  hasUnappliedFulfillmentTime: boolean;
  sessionReady: boolean;
  sessionExpired: boolean;
  customerDetailsMissing: boolean;
  deliveryDetailsMissing: boolean;
  requiredOptionMessage: string | null;
  waitAcknowledgmentRequired: boolean;
  hasTurnstileToken: boolean;
  messages: QrOrderCheckoutBlockerMessages;
};

type QrOrderCheckoutBlockerMessages = {
  orderingUnavailable: string;
  emptyCart: string;
  unappliedFulfillmentTime: string;
  sessionLoading: string;
  sessionExpired: string;
  customerDetailsMissing: string;
  deliveryDetailsMissing: string;
  waitAcknowledgmentRequired: string;
  securityRequired: string;
};

type QrOrderCheckoutMessages = QrOrderCheckoutBlockerMessages & {
  preorderTimeRequired: string;
  productUnavailable: string;
  invoiceDetailsInvalid: string;
  requiredNotes: (productName: string) => string;
};

export type QrOrderCheckoutFlowInput = {
  qrToken: string;
  entryChannel: QrOrderEntryChannel;
  orderingAvailability: PublicAvailabilityStatus | "CHECKING";
  orderingEnabled: boolean;
  orderingMode: QrCartOrderingMode;
  hasUnappliedFulfillmentTime: boolean;
  sessionReady: boolean;
  sessionExpired: boolean;
  session: QrOrderSession | null;
  deviceId: string;
  cartLines: QrCartLine[];
  visibleProducts: PublicMenuProduct[];
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  customerNote: string;
  scheduledPickupAt: string;
  lotteryDrawId: string | null;
  waitAcknowledged: boolean;
  turnstileToken: string | null;
  invoiceBuyerSelection: InvoiceBuyerSelection | null;
  localizedProductName: (product: PublicMenuProduct) => string;
  messages: QrOrderCheckoutMessages;
};

export type QrOrderCheckoutFlowEffects = {
  onMessage: (message: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
  onSessionUpdate: (
    update: (current: QrOrderSession | null) => QrOrderSession | null,
  ) => void;
  onWaitAcknowledgmentReset: () => void;
  onTurnstileInvalid: () => void;
  clearPersistedCart: () => void;
  navigateToOrder: (trackingToken: string) => void;
};

const PHONE_NUMBER = /^\+?[0-9][0-9 ().-]{5,29}$/;

class LocalizedCheckoutError extends Error {}

const defaultRequestOrder: QrOrderCheckoutTransport = async (body, operationId) => {
  const response = await requestPublicOrder(
    "create-public-order",
    body,
    { operationId },
  );
  return {
    ok: response.ok,
    status: response.status,
    payload: await parseEdgeResponse(response),
  };
};

export async function submitQrOrderCheckout(input: QrOrderCheckoutInput) {
  const requestOrder = input.requestOrder ?? defaultRequestOrder;
  input.onMessage("");
  input.onSubmittingChange(true);
  try {
    const response = await requestOrder(input.body, input.operationId);
    if (!response.ok) {
      const code = String(response.payload.code ?? "");
      if (code === "WAIT_ACKNOWLEDGMENT_REQUIRED") {
        const capacity = response.payload.capacity
          && typeof response.payload.capacity === "object"
          ? response.payload.capacity as Record<string, unknown>
          : null;
        input.onWaitAcknowledgmentRequired({
          estimatedWaitMinMinutes: capacity?.estimatedWaitMinMinutes,
          estimatedWaitMaxMinutes: capacity?.estimatedWaitMaxMinutes,
        });
      }
      if (code === "INVALID_TURNSTILE") input.onInvalidTurnstile();
      throw new LocalizedCheckoutError(input.localizeError(code));
    }

    const trackingToken = String(response.payload.trackingToken);
    const postOrderError = await input.afterOrderCreated?.(trackingToken);
    if (postOrderError) throw new LocalizedCheckoutError(postOrderError);
    try {
      input.clearPersistedCart();
    } catch {
      // The order already succeeded; storage cleanup is best effort.
    }
    input.navigateToOrder(trackingToken);
  } catch (error) {
    input.onMessage(
      error instanceof LocalizedCheckoutError ? error.message : input.networkError,
    );
  } finally {
    input.onSubmittingChange(false);
  }
}

export function resolveQrCheckoutBlocker(input: QrCheckoutBlockerInput) {
  if (input.orderingAvailability !== "AVAILABLE" && input.orderingAvailability !== "CHECKING") {
    return input.messages.orderingUnavailable;
  }
  if (input.totalQuantity === 0) return input.messages.emptyCart;
  if (input.hasUnappliedFulfillmentTime) return input.messages.unappliedFulfillmentTime;
  if (input.orderingAvailability === "CHECKING" || !input.sessionReady) {
    return input.messages.sessionLoading;
  }
  if (input.sessionExpired) return input.messages.sessionExpired;
  if (input.customerDetailsMissing) return input.messages.customerDetailsMissing;
  if (input.deliveryDetailsMissing) return input.messages.deliveryDetailsMissing;
  if (input.requiredOptionMessage) return input.requiredOptionMessage;
  if (input.waitAcknowledgmentRequired) return input.messages.waitAcknowledgmentRequired;
  if (!input.hasTurnstileToken) return input.messages.securityRequired;
  return "";
}

export function createQrOrderCheckoutModel(input: QrOrderCheckoutFlowInput) {
  const selectedItems: QrSelectedItem[] = input.cartLines.map(({
    productId,
    quantity,
    note,
    noteOptionIds,
    bundleChoiceIds,
  }) => ({
    productId,
    quantity,
    note,
    noteOptionIds,
    bundleChoiceIds,
  }));
  const totalQuantity = input.cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const requiresCustomerDetails = input.session?.stall.fulfillmentType === "TAKEOUT"
    || input.session?.stall.fulfillmentType === "DELIVERY";
  const customerDetailsMissing = requiresCustomerDetails
    && (
      input.customerName.trim().length === 0
      || !PHONE_NUMBER.test(input.customerPhone.trim())
    );
  const deliveryDetailsMissing = input.session?.stall.fulfillmentType === "DELIVERY"
    && input.deliveryAddress.trim().length === 0;
  const invalidCartLine = input.cartLines.find((line) => {
    const product = input.session?.products.find((candidate) => candidate.id === line.productId);
    return product && !validSelections(product, line);
  });
  const invalidCartProduct = invalidCartLine
    ? input.session?.products.find((product) => product.id === invalidCartLine.productId)
    : undefined;

  return {
    selectedItems,
    blocker: resolveQrCheckoutBlocker({
      orderingAvailability: input.orderingAvailability,
      totalQuantity,
      hasUnappliedFulfillmentTime: input.hasUnappliedFulfillmentTime,
      sessionReady: input.sessionReady,
      sessionExpired: input.sessionExpired,
      customerDetailsMissing,
      deliveryDetailsMissing,
      requiredOptionMessage: invalidCartProduct
        ? input.messages.requiredNotes(input.localizedProductName(invalidCartProduct))
        : input.invoiceBuyerSelection && !invoiceBuyerSelectionSchema.safeParse(input.invoiceBuyerSelection).success
          ? input.messages.invoiceDetailsInvalid
          : null,
      waitAcknowledgmentRequired: Boolean(
        input.session?.requiresWaitAcknowledgment && !input.waitAcknowledged,
      ),
      hasTurnstileToken: Boolean(input.turnstileToken),
      messages: input.messages,
    }),
  };
}

export async function submitQrOrderFlowCheckout({
  input,
  sessionController,
  networkError,
  localizeError,
  requestOrder,
  effects,
}: {
  input: QrOrderCheckoutFlowInput;
  sessionController: Pick<
    QrOrderSessionController,
    "checkoutIdentity" | "clearCheckoutIdentity"
  >;
  networkError: string;
  localizeError: (code: string) => string;
  requestOrder?: QrOrderCheckoutTransport;
  effects: QrOrderCheckoutFlowEffects;
}) {
  const model = createQrOrderCheckoutModel(input);
  const validationMessage = resolveQrOrderSubmitValidation(input, model.selectedItems);
  if (validationMessage) {
    effects.onMessage(validationMessage);
    return "BLOCKED" as const;
  }

  const session = input.session as QrOrderSession;
  const turnstileToken = input.turnstileToken as string;
  const fingerprint = createQrCheckoutFingerprint({
    orderingMode: input.orderingMode,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    deliveryAddress: input.deliveryAddress,
    customerNote: input.customerNote,
    scheduledPickupAt: input.scheduledPickupAt,
    lotteryDrawId: input.lotteryDrawId,
    selectedItems: model.selectedItems,
    waitAcknowledged: input.waitAcknowledged,
  });
  const identity = sessionController.checkoutIdentity(fingerprint);
  const request = buildQrPublicOrderRequest({
    qrToken: input.qrToken,
    orderSessionToken: session.orderSessionToken,
    deviceId: input.deviceId,
    identity,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    deliveryAddress: input.deliveryAddress,
    customerNote: input.customerNote,
    waitAcknowledged: input.waitAcknowledged,
    orderingMode: input.orderingMode,
    scheduledPickupAt: input.scheduledPickupAt,
    entryChannel: input.entryChannel,
    lotteryDrawId: input.lotteryDrawId,
    items: model.selectedItems,
    turnstileToken,
  });

  await submitQrOrderCheckout({
    body: request.body,
    operationId: request.operationId,
    networkError,
    localizeError,
    requestOrder,
    onMessage: effects.onMessage,
    onSubmittingChange: effects.onSubmittingChange,
    onWaitAcknowledgmentRequired: (capacity) => {
      effects.onSessionUpdate((current) => current ? {
        ...current,
        estimatedWaitMinutes: Number(
          capacity.estimatedWaitMaxMinutes ?? current.estimatedWaitMinutes,
        ),
        estimatedWaitMinMinutes: Number(
          capacity.estimatedWaitMinMinutes ?? current.estimatedWaitMinMinutes,
        ),
        estimatedWaitMaxMinutes: Number(
          capacity.estimatedWaitMaxMinutes ?? current.estimatedWaitMaxMinutes,
        ),
        requiresWaitAcknowledgment: true,
      } : current);
      effects.onWaitAcknowledgmentReset();
    },
    onInvalidTurnstile: () => {
      sessionController.clearCheckoutIdentity();
      effects.onTurnstileInvalid();
    },
    clearPersistedCart: effects.clearPersistedCart,
    navigateToOrder: effects.navigateToOrder,
    afterOrderCreated: input.invoiceBuyerSelection
      ? (trackingToken) => saveInvoicePreference({
          trackingToken,
          deviceId: input.deviceId,
          buyer: input.invoiceBuyerSelection as InvoiceBuyerSelection,
          failureMessage: input.messages.invoiceDetailsInvalid,
        })
      : undefined,
  });
  return "SUBMITTED" as const;
}

export async function submitQrOrderEditFlowCheckout({
  input,
  trackingToken,
  sessionController,
  networkError,
  localizeError,
  requestOrder,
  effects,
}: {
  input: QrOrderCheckoutFlowInput;
  trackingToken: string;
  sessionController: Pick<
    QrOrderSessionController,
    "checkoutIdentity" | "clearCheckoutIdentity"
  >;
  networkError: string;
  localizeError: (code: string) => string;
  requestOrder?: QrOrderCheckoutTransport;
  effects: QrOrderCheckoutFlowEffects;
}) {
  const model = createQrOrderCheckoutModel(input);
  const validationMessage = resolveQrOrderSubmitValidation(input, model.selectedItems);
  if (validationMessage) {
    effects.onMessage(validationMessage);
    return "BLOCKED" as const;
  }

  const fingerprint = createQrCheckoutFingerprint({
    orderingMode: input.orderingMode,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    deliveryAddress: input.deliveryAddress,
    customerNote: input.customerNote,
    scheduledPickupAt: input.scheduledPickupAt,
    lotteryDrawId: null,
    selectedItems: model.selectedItems,
    waitAcknowledged: input.waitAcknowledged,
  });
  const identity = sessionController.checkoutIdentity(fingerprint);
  const updateOrder = requestOrder ?? (async (body, operationId) => {
    const response = await fetch(`/api/public/orders/${encodeURIComponent(trackingToken)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...publicOrderCircuitHeaders(operationId),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    return {
      ok: response.ok,
      status: response.status,
      payload: await parseEdgeResponse(response),
    };
  });

  await submitQrOrderCheckout({
    body: {
      deviceId: input.deviceId,
      idempotencyKey: identity.key,
      turnstileToken: input.turnstileToken as string,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      deliveryAddress: input.deliveryAddress,
      customerNote: input.customerNote,
      items: model.selectedItems,
    },
    operationId: identity.operationId,
    networkError,
    localizeError,
    requestOrder: updateOrder,
    onMessage: effects.onMessage,
    onSubmittingChange: effects.onSubmittingChange,
    onWaitAcknowledgmentRequired: () => effects.onWaitAcknowledgmentReset(),
    onInvalidTurnstile: () => {
      sessionController.clearCheckoutIdentity();
      effects.onTurnstileInvalid();
    },
    clearPersistedCart: effects.clearPersistedCart,
    navigateToOrder: effects.navigateToOrder,
  });
  return "SUBMITTED" as const;
}

function resolveQrOrderSubmitValidation(
  input: QrOrderCheckoutFlowInput,
  selectedItems: QrSelectedItem[],
) {
  if (!input.orderingEnabled) return input.messages.orderingUnavailable;
  if (input.hasUnappliedFulfillmentTime) return input.messages.unappliedFulfillmentTime;
  if (
    !input.sessionReady
    || !input.session
    || !input.deviceId
    || !input.turnstileToken
    || selectedItems.length === 0
  ) {
    return !input.sessionReady
      ? input.messages.sessionLoading
      : !input.turnstileToken
        ? input.messages.securityRequired
        : input.messages.emptyCart;
  }
  if (sessionCountdownPhase(input.session.expiresAt) === "EXPIRED") {
    return input.messages.sessionExpired;
  }
  if (input.session.requiresWaitAcknowledgment && !input.waitAcknowledged) {
    return input.messages.waitAcknowledgmentRequired;
  }
  if (
    (input.session.stall.fulfillmentType === "TAKEOUT"
      || input.session.stall.fulfillmentType === "DELIVERY")
    && (
      input.customerName.trim().length === 0
      || !PHONE_NUMBER.test(input.customerPhone.trim())
    )
  ) {
    return input.messages.customerDetailsMissing;
  }
  if (
    input.session.stall.fulfillmentType === "DELIVERY"
    && !input.deliveryAddress.trim()
  ) {
    return input.messages.deliveryDetailsMissing;
  }
  if (input.orderingMode === "PREORDER" && !input.scheduledPickupAt) {
    return input.messages.preorderTimeRequired;
  }
  if (input.invoiceBuyerSelection && !invoiceBuyerSelectionSchema.safeParse(input.invoiceBuyerSelection).success) {
    return input.messages.invoiceDetailsInvalid;
  }
  const invalidLine = input.cartLines.find((line) => {
    const product = input.visibleProducts.find((candidate) => candidate.id === line.productId);
    return !product || !validSelections(product, line);
  });
  if (!invalidLine) return "";
  const invalidProduct = input.visibleProducts.find(
    (product) => product.id === invalidLine.productId,
  );
  return invalidProduct
    ? input.messages.requiredNotes(input.localizedProductName(invalidProduct))
    : input.messages.productUnavailable;
}

async function saveInvoicePreference(input: {
  trackingToken: string;
  deviceId: string;
  buyer: InvoiceBuyerSelection;
  failureMessage: string;
}) {
  try {
    const operationId = createPublicOrderOperationId();
    const response = await fetch(
      `/api/public/orders/${encodeURIComponent(input.trackingToken)}/invoice-preference`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...publicOrderCircuitHeaders(operationId),
        },
        body: JSON.stringify({ deviceId: input.deviceId, buyer: input.buyer }),
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      },
    );
    return response.ok ? null : input.failureMessage;
  } catch {
    return input.failureMessage;
  }
}

function validSelections(product: PublicMenuProduct, line: QrCartLine) {
  return noteSelectionIsValid(product.noteGroups, line.noteOptionIds)
    && bundleSelectionIsValid(product.bundleChoiceGroups, line.bundleChoiceIds);
}
