"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { persistQrOrderCartDraft } from "@/components/qr-order-cart-persistence";
import { startQrOrderAvailabilityLifecycle } from "@/components/qr-order-availability-controller";
import { startQrOrderCapacityLifecycle } from "@/components/qr-order-capacity-controller";
import {
  createQrOrderCheckoutModel,
  submitQrOrderFlowCheckout,
  type QrOrderCheckoutFlowInput,
} from "@/components/qr-order-checkout-controller";
import {
  startQrOrderCartDialogLifecycle,
  startQrOrderProductDialogLifecycle,
} from "@/components/qr-order-dialog-lifecycle";
import {
  applyQrOrderFulfillmentTime,
  buildQrOrderFulfillmentViewModel,
  selectQrOrderFulfillmentTime,
  type QrOrderFulfillmentEffects,
} from "@/components/qr-order-fulfillment-controller";
import { useQrOrderLotteryController } from "@/components/qr-order-lottery-controller";
import { useQrOrderProductController } from "@/components/qr-order-product-controller";
import { resolveQrOrderSessionTransition } from "@/components/qr-order-session-application";
import {
  buildQrCartDraft,
  usableQrInitialMenu,
  type QrOrderEntryChannel,
  type QrOrderSession,
} from "@/components/qr-order-flow-orchestration";
import { createQrOrderSessionController } from "@/components/qr-order-session-controller";
import { deliveryOrderMessages, localizedDeliveryOrderError } from "@/lib/delivery-order-i18n";
import {
  bundlePriceAdjustment,
} from "@/lib/product-bundle-selection";
import { notePriceAdjustment } from "@/lib/product-note-selection";
import {
  getOrCreateDeviceId,
  type PublicAvailabilityStatus,
} from "@/lib/public-order-client";
import {
  qrCartProductQuantity,
  qrCartStorageKey,
  qrCartTotalQuantity,
  serializeQrCartDraft,
  type QrCartLine,
} from "@/lib/qr-cart";
import type { SessionCountdownPhase } from "@/lib/session-countdown";
import { publicMenuProductsForPickup } from "@/lib/public-menu-availability";
import type {
  PublicMenu,
  PublicMenuBundleChoiceOption as BundleChoiceOption,
  PublicMenuNoteGroup as NoteGroup,
  PublicMenuNoteOption as NoteOption,
  PublicMenuProduct as Product,
} from "@/lib/public-menu-types";
import {
  isQrLocale,
  localizedQrCategory,
  localizedPublicOrderError,
  preserveSupportedQrLocale,
  QR_LOCALES,
  QR_LOCALE_STORAGE_KEY,
  QR_UI_LOCALE_STORAGE_KEY,
  qrOrderMessages,
  resolveQrCatalogLocale,
  resolveQrUiLocale,
  serializeQrLocalePreference,
  type QrLocale,
} from "@/lib/qr-order-i18n";

export type QrOrderFlowControllerInput = {
  qrToken: string;
  orderingMode?: "DEFAULT" | "DELIVERY" | "PREORDER";
  initialMenu?: PublicMenu | null;
  entryChannel?: QrOrderEntryChannel;
  initialUiLocale?: QrLocale;
  requestedLocale?: QrLocale | null;
};

export function useQrOrderFlowController({
  qrToken,
  orderingMode = "DEFAULT",
  initialMenu = null,
  entryChannel = "QR",
  initialUiLocale = "zh-TW",
  requestedLocale = null,
}: QrOrderFlowControllerInput) {
  const usableInitialMenu = usableQrInitialMenu(entryChannel, initialMenu);
  const initialResolvedLocale = usableInitialMenu
    ? preserveSupportedQrLocale(initialUiLocale, usableInitialMenu.supportedLocales)
    : initialUiLocale;
  const startedRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const [sessionController] = useState(() => createQrOrderSessionController());
  const localeRef = useRef<QrLocale>(initialResolvedLocale);
  const productConfigurationRef = useRef<HTMLElement>(null);
  const cartPanelRef = useRef<HTMLElement>(null);
  const cartCloseButtonRef = useRef<HTMLButtonElement>(null);
  const cartTriggerRef = useRef<HTMLButtonElement>(null);
  const cartContinueButtonRef = useRef<HTMLButtonElement>(null);
  const checkoutHeadingRef = useRef<HTMLHeadingElement>(null);
  const availabilityStatusRef = useRef<PublicAvailabilityStatus | "CHECKING">("CHECKING");
  const scheduledPickupAtRef = useRef("");
  const refreshAvailabilityRef = useRef<(retrySession?: boolean) => void>(() => undefined);
  const [deviceId, setDeviceId] = useState("");
  const [activeOrderingMode, setActiveOrderingMode] = useState(orderingMode);
  const [session, setSession] = useState<QrOrderSession | null>(usableInitialMenu
    ? { ...usableInitialMenu, orderSessionToken: "", expiresAt: "" }
    : null);
  const [cartLines, setCartLines] = useState<QrCartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [scheduledPickupAt, setScheduledPickupAt] = useState("");
  const [draftScheduledPickupAt, setDraftScheduledPickupAt] = useState(
    usableInitialMenu?.orderingMode === "PREORDER" ? usableInitialMenu.preorderSlots[0] ?? "" : "",
  );
  const [customerNote, setCustomerNote] = useState("");
  const [waitAcknowledged, setWaitAcknowledged] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [turnstileRequested, setTurnstileRequested] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionStartError, setSessionStartError] = useState("");
  const [isLoading, setIsLoading] = useState(!usableInitialMenu);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionTimePhase, setSessionTimePhase] = useState<SessionCountdownPhase>("INACTIVE");
  const [locale, setLocale] = useState<QrLocale>(initialResolvedLocale);
  const [cartReady, setCartReady] = useState(false);
  const [cartRestored, setCartRestored] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartStep, setCartStep] = useState<"CART" | "CHECKOUT">("CART");
  const [orderingAvailability, setOrderingAvailability] = useState<
    PublicAvailabilityStatus | "CHECKING"
  >("CHECKING");
  const [availabilityRefreshing, setAvailabilityRefreshing] = useState(false);
  const copy = qrOrderMessages[locale];
  const deliveryCopy = deliveryOrderMessages[locale];
  const sessionReady = Boolean(session?.orderSessionToken && session.expiresAt);
  const sessionExpiryDialogOpen = sessionReady
    && (sessionTimePhase === "EXPIRING" || sessionTimePhase === "EXPIRED");
  const cartDialogOpen = cartOpen && !sessionExpiryDialogOpen;
  const specialClosureActive = session?.specialClosure?.isActive === true;
  const orderingEnabled = orderingAvailability === "AVAILABLE" && sessionReady && !specialClosureActive;
  const degradedMode = orderingAvailability !== "AVAILABLE"
    && orderingAvailability !== "CHECKING";
  const visibleProducts = useMemo(() => {
    if (!session) return [];
    return activeOrderingMode === "PREORDER"
      ? publicMenuProductsForPickup(session.products, scheduledPickupAt)
      : session.products;
  }, [activeOrderingMode, scheduledPickupAt, session]);
  const catalogLocale = resolveQrCatalogLocale(locale, session?.supportedLocales ?? []);
  const localizedProduct = useCallback((product: Product) => {
    const translation = product.translations.find((item) => item.locale === catalogLocale);
    return translation ? { name: translation.name, description: translation.description } : product;
  }, [catalogLocale]);
  const localizedCategory = useCallback((category: string) => {
    const product = session?.products.find((item) => item.category === category);
    return product?.categoryTranslations?.find((item) => item.locale === catalogLocale)?.name
      ?? localizedQrCategory(catalogLocale, category);
  }, [catalogLocale, session]);
  const localizedProductGroup = useCallback((product: Product) => (
    product.groupTranslations?.find((item) => item.locale === catalogLocale)?.name
      ?? product.group
      ?? ""
  ), [catalogLocale]);
  const focusConfiguredProduct = useCallback((productId: string) => {
    window.setTimeout(() => document.getElementById(`qr-product-${productId}`)?.focus(), 0);
  }, []);
  const requiredSelectionMessage = useCallback((product: Product) => (
    qrOrderMessages[locale].requiredNotes(localizedProduct(product).name)
  ), [locale, localizedProduct]);
  const {
    productDrafts,
    editingLineIds,
    configuringProductId,
    updateQuantity,
    selectNoteOption,
    selectBundleChoice,
    addProductDraft,
    changeCartLineQuantity,
    editCartLine,
    cancelProductConfiguration,
    reconcileAvailableProducts,
    configureLotteryProduct,
  } = useQrOrderProductController({
    products: session?.products ?? [],
    limits: session?.limits ?? null,
    activeOrderingMode,
    scheduledPickupAt,
    orderingEnabled,
    cartLines,
    setCartLines,
    setCartOpen,
    setMessage,
    setTurnstileRequested,
    quantityLimitMessage: copy.quantityLimit,
    requiredSelectionMessage,
    focusProduct: focusConfiguredProduct,
  });
  const {
    lotteryButtonRef,
    lotteryDraw,
    isDrawingLottery,
    lotteryLimitDialogOpen,
    lotteryError,
    prefersReducedMotion,
    lotteryDialogVisible,
    drawLottery,
    acceptLotteryRecommendation,
    cancelLotteryRecommendation,
    closeLotteryLimitDialog,
    clearLotteryDraw,
    resetLotteryForSession,
  } = useQrOrderLotteryController({
    session,
    sessionReady,
    sessionExpiryDialogOpen,
    deviceId,
    visibleProducts,
    unavailableProductMessage: copy.lotteryUnavailableProduct,
    onSessionPhaseChange: setSessionTimePhase,
    onMessage: setMessage,
    onAddSimpleProduct: (productId) => {
      updateQuantity(productId, qrCartProductQuantity(cartLines, productId) + 1);
    },
    onConfigureProduct: configureLotteryProduct,
  });
  const closeCart = useCallback(() => {
    setCartOpen(false);
    window.requestAnimationFrame(() => cartTriggerRef.current?.focus());
  }, []);

  const updateOrderingAvailability = useCallback((
    status: PublicAvailabilityStatus | "CHECKING",
  ) => {
    availabilityStatusRef.current = status;
    setOrderingAvailability(status);
  }, []);

  const startOrderSession = useCallback(async (
    currentDeviceId: string,
    browserLocale: QrLocale,
  ) => {
    if (usableInitialMenu?.specialClosure?.isActive) {
      setIsLoading(false);
      setSessionStartError("");
      return;
    }
    setIsLoading(!usableInitialMenu);
    setSessionStartError("");
    const result = await sessionController.start({
      qrToken,
      deviceId: currentDeviceId,
      activeOrderingMode,
      entryChannel,
      initialMenu,
      currentScheduledPickupAt: scheduledPickupAtRef.current,
      loadCartDraft: (resolvedOrderingMode) => window.localStorage.getItem(
        qrCartStorageKey(qrToken, resolvedOrderingMode),
      ),
    });
    try {
      const transition = resolveQrOrderSessionTransition({
        result,
        browserLocale,
        currentLocale: localeRef.current,
        hasUsableInitialMenu: Boolean(usableInitialMenu),
        currentAvailability: availabilityStatusRef.current,
      });
      if (transition.kind === "STALE") return;
      if (transition.kind === "RESUME") {
        window.location.replace(`/order/${encodeURIComponent(transition.trackingToken)}`);
        return;
      }
      if (transition.kind === "FAILURE") {
        sessionReadyRef.current = false;
        if (transition.availability) updateOrderingAvailability(transition.availability);
        setSessionStartError(transition.message);
        setMessage(transition.message);
        return;
      }
      const orderSession = transition.session;
      const cartRecovery = transition.cartRecovery;
      const nextLocale = transition.locale;
      localeRef.current = nextLocale;
      setLocale(nextLocale);
      if (cartRecovery.restored) {
        setCustomerName(cartRecovery.customerName);
        setCustomerNote(cartRecovery.customerNote);
        setCustomerPhone(cartRecovery.customerPhone);
        setDeliveryAddress(cartRecovery.deliveryAddress);
        setCartLines(cartRecovery.lines);
        setCartRestored(true);
        if (cartRecovery.lines.length > 0) setTurnstileRequested(true);
      }
      sessionReadyRef.current = true;
      setSessionTimePhase(transition.sessionTimePhase);
      if (transition.availability) updateOrderingAvailability(transition.availability);
      setSession(orderSession);
      setActiveOrderingMode(orderSession.orderingMode);
      scheduledPickupAtRef.current = cartRecovery.scheduledPickupAt;
      setScheduledPickupAt(cartRecovery.scheduledPickupAt);
      setDraftScheduledPickupAt(cartRecovery.draftScheduledPickupAt);
      resetLotteryForSession(transition.resetPreorderLottery);
      setCartReady(true);
      setSessionStartError("");
      setMessage("");
    } catch {
      if (!sessionController.isCurrentAttempt(result.attempt)) return;
      sessionReadyRef.current = false;
      if (usableInitialMenu && (
        availabilityStatusRef.current === "CHECKING"
        || availabilityStatusRef.current === "AVAILABLE"
        || availabilityStatusRef.current === "UNKNOWN"
      )) {
        updateOrderingAvailability("UNAVAILABLE");
      }
      const errorMessage = qrOrderMessages[browserLocale].networkError;
      setSessionStartError(errorMessage);
      setMessage(errorMessage);
    } finally {
      if (sessionController.isCurrentAttempt(result.attempt)) setIsLoading(false);
    }
  }, [
    activeOrderingMode,
    entryChannel,
    initialMenu,
    qrToken,
    resetLotteryForSession,
    sessionController,
    updateOrderingAvailability,
    usableInitialMenu,
  ]);

  useEffect(() => {
    if (!cartDialogOpen) return;
    return startQrOrderCartDialogLifecycle({
      panel: cartPanelRef.current,
      closeButton: cartCloseButtonRef.current,
      onClose: closeCart,
    });
  }, [cartDialogOpen, closeCart]);

  useEffect(() => {
    if (!configuringProductId || sessionExpiryDialogOpen) return;
    return startQrOrderProductDialogLifecycle({
      panel: productConfigurationRef.current,
      onCancel: () => cancelProductConfiguration(configuringProductId),
    });
  }, [cancelProductConfiguration, configuringProductId, sessionExpiryDialogOpen]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const currentDeviceId = getOrCreateDeviceId();
    let storedPreference: string | null = null;
    let legacyLocale: string | null = null;
    try {
      storedPreference = window.localStorage.getItem(QR_UI_LOCALE_STORAGE_KEY);
      legacyLocale = window.localStorage.getItem(QR_LOCALE_STORAGE_KEY);
    } catch {
      storedPreference = null;
      legacyLocale = null;
    }
    const resolvedLocale = resolveQrUiLocale({
      queryLocale: requestedLocale,
      storedPreference,
      legacyLocale,
      appLocale: initialUiLocale,
    });
    const browserLocale = resolvedLocale.locale;
    if (resolvedLocale.source === "query" || resolvedLocale.shouldMigrateLegacy) {
      try {
        window.localStorage.setItem(
          QR_UI_LOCALE_STORAGE_KEY,
          serializeQrLocalePreference(
            browserLocale,
            resolvedLocale.source === "query" ? "query" : "manual",
          ),
        );
        window.localStorage.removeItem(QR_LOCALE_STORAGE_KEY);
      } catch {
        // Browsers can block storage in private or restricted contexts.
      }
    }
    localeRef.current = browserLocale;
    setLocale(browserLocale);
    setDeviceId(currentDeviceId);
    void startOrderSession(currentDeviceId, browserLocale);
  }, [initialUiLocale, requestedLocale, startOrderSession]);

  useEffect(() => {
    if (!deviceId) return;
    const lifecycle = startQrOrderAvailabilityLifecycle({
      deviceId,
      sessionReady: () => sessionReadyRef.current,
      currentStatus: () => availabilityStatusRef.current,
      onRefreshingChange: setAvailabilityRefreshing,
      onMissingAvailability: () => updateOrderingAvailability("UNAVAILABLE"),
      onOrderingDisabled: (status) => {
        sessionReadyRef.current = false;
        setSessionStartError("");
        setSession((current) => current ? {
          ...current,
          orderSessionToken: "",
          expiresAt: "",
        } : current);
        setSessionTimePhase("INACTIVE");
        setTurnstileToken(null);
        setTurnstileRequested(false);
        updateOrderingAvailability(status);
      },
      onOrderingAvailable: async ({ targetChanged, shouldStartSession }) => {
        updateOrderingAvailability("AVAILABLE");
        if (!shouldStartSession) return;
        if (targetChanged) sessionController.rotateSessionIdentity();
        await startOrderSession(deviceId, localeRef.current);
      },
    });
    refreshAvailabilityRef.current = (retrySession = false) => {
      void lifecycle.refresh(retrySession, true);
    };
    return () => {
      lifecycle.stop();
      refreshAvailabilityRef.current = () => undefined;
    };
  }, [deviceId, sessionController, startOrderSession, updateOrderingAvailability]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!deviceId || !sessionReady || !session?.orderSessionToken) return;
    const lifecycle = startQrOrderCapacityLifecycle({
      qrToken,
      deviceId,
      orderingMode: activeOrderingMode,
      orderSessionToken: session.orderSessionToken,
      expiresAt: session.expiresAt,
      currentQuote: {
        estimatedWaitMinMinutes: session.estimatedWaitMinMinutes,
        estimatedWaitMaxMinutes: session.estimatedWaitMaxMinutes,
        requiresWaitAcknowledgment: session.requiresWaitAcknowledgment,
      },
      sessionReady: () => sessionReadyRef.current,
      sessionRequestId: () => sessionController.sessionRequestId(),
      onQuote: (quote) => {
        if (quote.resetWaitAcknowledgment) setWaitAcknowledged(false);
        setSession((current) => {
          if (!current || current.orderSessionToken !== session.orderSessionToken) return current;
          return {
            ...current,
            estimatedWaitMinutes: Number.isFinite(quote.estimatedWaitMaxMinutes)
              ? quote.estimatedWaitMaxMinutes
              : current.estimatedWaitMinutes,
            estimatedWaitMinMinutes: Number.isFinite(quote.estimatedWaitMinMinutes)
              ? quote.estimatedWaitMinMinutes
              : current.estimatedWaitMinMinutes,
            estimatedWaitMaxMinutes: Number.isFinite(quote.estimatedWaitMaxMinutes)
              ? quote.estimatedWaitMaxMinutes
              : current.estimatedWaitMaxMinutes,
            waitAcknowledgmentThresholdMinutes:
              quote.waitAcknowledgmentThresholdMinutes === null
              || Number.isFinite(quote.waitAcknowledgmentThresholdMinutes)
              ? quote.waitAcknowledgmentThresholdMinutes
              : current.waitAcknowledgmentThresholdMinutes,
            requiresWaitAcknowledgment: quote.requiresWaitAcknowledgment,
          };
        });
      },
    });
    return () => lifecycle.stop();
  }, [
    activeOrderingMode,
    deviceId,
    qrToken,
    sessionController,
    session?.estimatedWaitMaxMinutes,
    session?.estimatedWaitMinMinutes,
    session?.expiresAt,
    session?.orderSessionToken,
    session?.requiresWaitAcknowledgment,
    sessionReady,
  ]);

  useEffect(() => {
    persistQrOrderCartDraft({
      sessionReady: Boolean(session),
      cartReady,
      qrToken,
      orderingMode: activeOrderingMode,
      scheduledPickupAt,
      customerName,
      customerNote,
      customerPhone,
      deliveryAddress,
      lines: cartLines,
    }, () => window.localStorage);
  }, [activeOrderingMode, cartLines, cartReady, customerName, customerNote, customerPhone, deliveryAddress, qrToken, scheduledPickupAt, session]);

  const totalQuantity = qrCartTotalQuantity(cartLines);
  const activeCartStep = cartLines.length === 0 ? "CART" : cartStep;
  const total = session ? cartLines.reduce((sum, line) => {
    const product = session.products.find((candidate) => candidate.id === line.productId);
    if (!product) return sum;
    return sum + Math.max(
      0,
      product.price
        + notePriceAdjustment(product.noteGroups, line.noteOptionIds)
        + bundlePriceAdjustment(product.bundleChoiceGroups, line.bundleChoiceIds),
    ) * line.quantity;
  }, 0) : 0;
  const categories = [...new Set(visibleProducts.map((product) => product.category))];
  const fulfillment = useMemo(() => buildQrOrderFulfillmentViewModel({
    entryChannel,
    session,
    orderingMode: activeOrderingMode,
    scheduledPickupAt,
    draftScheduledPickupAt,
  }), [activeOrderingMode, draftScheduledPickupAt, entryChannel, scheduledPickupAt, session]);
  const hasUnappliedFulfillmentTime = fulfillment.hasUnappliedTime;
  const localizedGroupName = useCallback((group: NoteGroup) => group.translations.find((item) => item.locale === catalogLocale)?.name ?? group.name, [catalogLocale]);
  const localizedOptionName = useCallback((option: NoteOption) => option.translations.find((item) => item.locale === catalogLocale)?.name ?? option.name, [catalogLocale]);
  const bundleChoiceLabel = useCallback((option: BundleChoiceOption) => (
    option.quantity > 1
      ? `${option.componentProductName} × ${option.quantity}`
      : option.componentProductName
  ), []);
  const lotteryResultProduct = lotteryDraw
    ? visibleProducts.find((product) => product.id === lotteryDraw.productId) ?? null
    : null;
  const lotteryCarouselProductNames = visibleProducts.map((product) => localizedProduct(product).name);

  function changeLocale(nextLocale: string) {
    if (!isQrLocale(nextLocale)) return;
    localeRef.current = nextLocale;
    setLocale(nextLocale);
    setMessage("");
    try {
      window.localStorage.setItem(
        QR_UI_LOCALE_STORAGE_KEY,
        serializeQrLocalePreference(nextLocale),
      );
      window.localStorage.removeItem(QR_LOCALE_STORAGE_KEY);
    } catch {
      // Browsers can block storage in private or restricted contexts.
    }
    refreshAvailabilityRef.current();
  }

  const handleTurnstileToken = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  const fulfillmentEffects: QrOrderFulfillmentEffects = {
    onScheduleApplied: (value) => {
      scheduledPickupAtRef.current = value;
      setScheduledPickupAt(value);
    },
    onDraftChanged: setDraftScheduledPickupAt,
    onMessageCleared: () => setMessage(""),
    onCartChanged: setCartLines,
    onProductsReconciled: reconcileAvailableProducts,
    onLotteryCleared: clearLotteryDraw,
  };

  function selectFulfillmentTime(value: string) {
    selectQrOrderFulfillmentTime({
      value,
      orderingMode: activeOrderingMode,
      session,
      cartLines,
    }, fulfillmentEffects);
  }

  function applyFulfillmentTime(value: string) {
    applyQrOrderFulfillmentTime({
      value,
      orderingMode: activeOrderingMode,
      session,
      cartLines,
    }, fulfillmentEffects);
  }

  function reloadWithPersistedCart() {
    try {
      const draft = buildQrCartDraft({
        orderingMode: activeOrderingMode,
        scheduledPickupAt,
        customerName,
        customerNote,
        customerPhone,
        deliveryAddress,
        lines: cartLines,
      });
      const storageKey = qrCartStorageKey(qrToken, activeOrderingMode);
      if (draft) {
        window.localStorage.setItem(storageKey, serializeQrCartDraft(draft));
      } else {
        window.localStorage.removeItem(storageKey);
      }
    } catch {
      // Restricted browser storage must not block creation of a fresh session.
    }
    window.location.reload();
  }

  function checkoutFlowInput(): QrOrderCheckoutFlowInput {
    return {
      qrToken,
      entryChannel,
      orderingAvailability,
      orderingEnabled,
      orderingMode: activeOrderingMode,
      hasUnappliedFulfillmentTime,
      sessionReady,
      sessionExpired: sessionTimePhase === "EXPIRED",
      session,
      deviceId,
      cartLines,
      visibleProducts,
      customerName,
      customerPhone,
      deliveryAddress,
      customerNote,
      scheduledPickupAt,
      lotteryDrawId: lotteryDraw?.drawId ?? null,
      waitAcknowledged,
      turnstileToken,
      localizedProductName: (product) => localizedProduct(product).name,
      messages: {
        orderingUnavailable: copy.degradedMessage,
        emptyCart: copy.selectAtLeastOne,
        unappliedFulfillmentTime: copy.applyPickupTimeRequired,
        sessionLoading: copy.sessionLoading,
        sessionExpired: copy.sessionExpired,
        deliveryDetailsMissing: deliveryCopy.detailsRequired,
        waitAcknowledgmentRequired: copy.waitAcknowledgmentRequired,
        securityRequired: copy.securityRequired,
        preorderTimeRequired: copy.selectPreorderTimeRequired,
        productUnavailable: copy.errors.productUnavailable,
        requiredNotes: copy.requiredNotes,
      },
    };
  }

  async function submitOrder() {
    await submitQrOrderFlowCheckout({
      input: checkoutFlowInput(),
      sessionController,
      networkError: copy.networkError,
      localizeError: (code) => (
        localizedDeliveryOrderError(locale, code) ?? localizedPublicOrderError(locale, code)
      ),
      effects: {
        onMessage: setMessage,
        onSubmittingChange: setIsSubmitting,
        onSessionUpdate: setSession,
        onWaitAcknowledgmentReset: () => setWaitAcknowledged(false),
        onTurnstileInvalid: () => {
          setTurnstileToken(null);
          setTurnstileResetKey((value) => value + 1);
        },
        clearPersistedCart: () => {
          window.localStorage.removeItem(qrCartStorageKey(qrToken, activeOrderingMode));
        },
        navigateToOrder: (trackingToken) => {
          window.location.assign(`/order/${encodeURIComponent(trackingToken)}`);
        },
      },
    });
  }

  const availableLocales = session
    ? QR_LOCALES.filter((candidate) => (
      candidate === "zh-TW" || session.supportedLocales.includes(candidate)
    ))
    : [...QR_LOCALES];
  const checkoutBlocker = createQrOrderCheckoutModel(checkoutFlowInput()).blocker;

  return {
    activeCartStep,
    activeOrderingMode,
    addProductDraft,
    applyFulfillmentTime,
    availabilityRefreshing,
    availableLocales,
    bundleChoiceLabel,
    cancelLotteryRecommendation,
    cancelProductConfiguration,
    cartCloseButtonRef,
    cartContinueButtonRef,
    cartDialogOpen,
    cartLines,
    cartOpen,
    cartPanelRef,
    cartRestored,
    cartTriggerRef,
    catalogLocale,
    categories,
    changeCartLineQuantity,
    changeLocale,
    checkoutBlocker,
    checkoutHeadingRef,
    closeCart,
    closeLotteryLimitDialog,
    configuringProductId,
    copy,
    customerName,
    customerNote,
    customerPhone,
    degradedMode,
    deliveryAddress,
    deliveryCopy,
    draftScheduledPickupAt,
    drawLottery,
    editingLineIds,
    editCartLine,
    fulfillment,
    handleTurnstileToken,
    hasUnappliedFulfillmentTime,
    isDrawingLottery,
    isLoading,
    isSubmitting,
    locale,
    localizedCategory,
    localizedGroupName,
    localizedOptionName,
    localizedProduct,
    localizedProductGroup,
    lotteryButtonRef,
    lotteryCarouselProductNames,
    lotteryDialogVisible,
    lotteryDraw,
    lotteryError,
    lotteryLimitDialogOpen,
    lotteryResultProduct,
    message,
    orderingAvailability,
    orderingEnabled,
    prefersReducedMotion,
    productConfigurationRef,
    productDrafts,
    refreshAvailability: (retrySession = false) => refreshAvailabilityRef.current(retrySession),
    reloadWithPersistedCart,
    scheduledPickupAt,
    selectBundleChoice,
    selectFulfillmentTime,
    selectNoteOption,
    session,
    sessionExpiryDialogOpen,
    sessionReady,
    sessionStartError,
    sessionTimePhase,
    setCartOpen,
    setCartStep,
    setCustomerName,
    setCustomerNote,
    setCustomerPhone,
    setDeliveryAddress,
    setMessage,
    setSessionTimePhase,
    setWaitAcknowledged,
    submitOrder,
    total,
    totalQuantity,
    turnstileRequested,
    turnstileResetKey,
    updateQuantity,
    visibleProducts,
    waitAcknowledged,
    acceptLotteryRecommendation,
  };
}

export type QrOrderFlowController = ReturnType<typeof useQrOrderFlowController>;
