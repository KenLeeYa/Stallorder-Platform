"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  Clock3,
  Dices,
  History,
  Minus,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  ShoppingCart,
  X,
} from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { QrLanguageSelector } from "@/components/qr-language-selector";
import { deliveryOrderMessages, localizedDeliveryOrderError } from "@/lib/delivery-order-i18n";
import { formatMoney } from "@/lib/money";
import {
  bundlePriceAdjustment,
  bundleSelectionIsValid,
  toggleBundleChoice,
} from "@/lib/product-bundle-selection";
import { notePriceAdjustment, noteSelectionIsValid, toggleNoteOption } from "@/lib/product-note-selection";
import { formatPreorderSlot } from "@/lib/preorder-slot-format";
import {
  getPublicAvailability,
  getOrCreateDeviceId,
  parseEdgeResponse,
  requestPublicOrder,
  type PublicAvailabilityStatus,
} from "@/lib/public-order-client";
import {
  resolvePublicOrderingMode,
  shouldIncludeFullSessionMenu,
  shouldReloadResolvedSessionMenu,
  shouldRotateSessionRequestId,
} from "@/lib/public-order-session-retry";
import {
  addQrCartLine,
  qrCartProductQuantity,
  qrCartStorageKey,
  qrCartTotalQuantity,
  restoreQrCartDraft,
  serializeQrCartDraft,
  updateQrCartLineQuantity,
  type QrCartLine,
} from "@/lib/qr-cart";
import { shouldRefreshQrCapacity } from "@/lib/qr-capacity-refresh";
import {
  prunePublicCartLinesForProducts,
  publicMenuProductsForPickup,
} from "@/lib/public-menu-availability";
import type {
  PublicMenu,
  PublicMenuBundleChoiceGroup as BundleChoiceGroup,
  PublicMenuBundleChoiceOption as BundleChoiceOption,
  PublicMenuNoteGroup as NoteGroup,
  PublicMenuNoteOption as NoteOption,
  PublicMenuProduct as Product,
} from "@/lib/public-menu-types";
import {
  isQrLocale,
  localizedPublicOrderError,
  localizedQrCategory,
  QR_LOCALES,
  QR_LOCALE_STORAGE_KEY,
  qrOrderMessages,
  preserveSupportedQrLocale,
  resolvePreferredQrLocale,
  type QrLocale,
} from "@/lib/qr-order-i18n";

const TurnstileWidget = dynamic(
  () => import("@/components/turnstile-widget").then((module) => module.TurnstileWidget),
  { ssr: false, loading: () => <div className="min-h-16 w-full" aria-hidden="true" /> },
);

type OrderSession = PublicMenu & {
  orderSessionToken: string;
  expiresAt: string;
};

type Props = {
  qrToken: string;
  orderingMode?: "DEFAULT" | "DELIVERY" | "PREORDER";
  initialMenu?: PublicMenu | null;
};

type LotteryDraw = {
  drawId: string;
  productId: string;
  productName: string;
  discountWon: boolean;
  discountLabel: string | null;
};

type ProductDraft = {
  quantity: number;
  noteOptionIds: string[];
  bundleChoiceIds: string[];
};

class LocalizedOrderError extends Error {}
const PHONE_NUMBER = /^\+?[0-9][0-9 ().-]{5,29}$/;

export function QrOrderFlow({ qrToken, orderingMode = "DEFAULT", initialMenu = null }: Props) {
  const startedRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const sessionRequestIdRef = useRef<string | null>(null);
  const sessionAttemptGenerationRef = useRef(0);
  const localeRef = useRef<QrLocale>("zh-TW");
  const availabilityTargetRef = useRef<string | null>(null);
  const availabilityStatusRef = useRef<PublicAvailabilityStatus | "CHECKING">("CHECKING");
  const scheduledPickupAtRef = useRef(initialMenu?.preorderSlots[0] ?? "");
  const secondsRemainingRef = useRef(0);
  const lastCapacityRefreshAtRef = useRef(0);
  const capacityRefreshInFlightRef = useRef(false);
  const capacityRefreshStoppedRef = useRef(false);
  const refreshAvailabilityRef = useRef<(retrySession?: boolean) => void>(() => undefined);
  const idempotencyRef = useRef<{
    key: string;
    clientOrderId: string;
    turnstileIdempotencyKey: string;
    fingerprint: string;
  } | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [activeOrderingMode, setActiveOrderingMode] = useState(orderingMode);
  const [session, setSession] = useState<OrderSession | null>(initialMenu
    ? { ...initialMenu, orderSessionToken: "", expiresAt: "" }
    : null);
  const [cartLines, setCartLines] = useState<QrCartLine[]>([]);
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
  const [editingLineIds, setEditingLineIds] = useState<Record<string, string>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [scheduledPickupAt, setScheduledPickupAt] = useState(
    initialMenu?.preorderSlots[0] ?? "",
  );
  const [lotteryDraw, setLotteryDraw] = useState<LotteryDraw | null>(null);
  const [isDrawingLottery, setIsDrawingLottery] = useState(false);
  const [customerNote, setCustomerNote] = useState("");
  const [waitAcknowledged, setWaitAcknowledged] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [turnstileRequested, setTurnstileRequested] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionStartError, setSessionStartError] = useState("");
  const [isLoading, setIsLoading] = useState(!initialMenu);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [locale, setLocale] = useState<QrLocale>("zh-TW");
  const [cartReady, setCartReady] = useState(false);
  const [cartRestored, setCartRestored] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderingAvailability, setOrderingAvailability] = useState<
    PublicAvailabilityStatus | "CHECKING"
  >("CHECKING");
  const [availabilityRefreshing, setAvailabilityRefreshing] = useState(false);
  const copy = qrOrderMessages[locale];
  const deliveryCopy = deliveryOrderMessages[locale];
  const sessionReady = Boolean(session?.orderSessionToken && session.expiresAt);
  const orderingEnabled = orderingAvailability === "AVAILABLE" && sessionReady;
  const degradedMode = orderingAvailability !== "AVAILABLE"
    && orderingAvailability !== "CHECKING";

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
    const attemptGeneration = sessionAttemptGenerationRef.current + 1;
    sessionAttemptGenerationRef.current = attemptGeneration;
    if (!sessionRequestIdRef.current) sessionRequestIdRef.current = crypto.randomUUID();
    setIsLoading(!initialMenu);
    setSessionStartError("");
    try {
      const requestSession = async (includeMenu: boolean) => {
        const response = await requestPublicOrder("create-order-session", {
          qrToken,
          deviceId: currentDeviceId,
          sessionRequestId: sessionRequestIdRef.current,
          orderingMode: activeOrderingMode,
          includeMenu,
        });
        return { response, payload: await parseEdgeResponse(response) };
      };
      let { response, payload } = await requestSession(
        shouldIncludeFullSessionMenu(Boolean(initialMenu), activeOrderingMode),
      );
      if (attemptGeneration !== sessionAttemptGenerationRef.current) return;
      if (
        response.ok
        && initialMenu
        && !(payload.resumeOrder && typeof payload.resumeOrder === "object")
        && shouldReloadResolvedSessionMenu(initialMenu.orderingMode, payload.orderingMode)
      ) {
        ({ response, payload } = await requestSession(true));
        if (attemptGeneration !== sessionAttemptGenerationRef.current) return;
      }
      if (!response.ok) {
        const code = String(payload.code ?? "");
        if (shouldRotateSessionRequestId(response.status, code)) sessionRequestIdRef.current = null;
        if (code === "QR_ORDERING_DEGRADED") updateOrderingAvailability("DEGRADED");
        if (code === "QR_ORDERING_UNAVAILABLE") updateOrderingAvailability("UNAVAILABLE");
        throw new LocalizedOrderError(
          localizedDeliveryOrderError(browserLocale, code)
          ?? localizedPublicOrderError(browserLocale, code),
        );
      }
      if (payload.resumeOrder && typeof payload.resumeOrder === "object") {
        const trackingToken = String((payload.resumeOrder as Record<string, unknown>).trackingToken ?? "");
        if (!trackingToken) throw new LocalizedOrderError(qrOrderMessages[browserLocale].sessionStartError);
        window.location.replace(`/order/${encodeURIComponent(trackingToken)}`);
        return;
      }
      const rawOrderSession = initialMenu
        ? { ...initialMenu, ...payload } as OrderSession
        : payload as unknown as OrderSession;
      const resolvedOrderingMode = resolvePublicOrderingMode(
        rawOrderSession.orderingMode,
        initialMenu?.orderingMode ?? activeOrderingMode,
      );
      const orderSession: OrderSession = {
        ...rawOrderSession,
        orderingMode: resolvedOrderingMode,
        preorderSlots: Array.isArray(rawOrderSession.preorderSlots)
          ? rawOrderSession.preorderSlots
          : [],
        lotteryEnabled: resolvedOrderingMode === "DEFAULT" && rawOrderSession.lotteryEnabled === true,
        products: rawOrderSession.products.map((product) => ({
          ...product,
          kind: product.kind === "BUNDLE" ? "BUNDLE" : "SINGLE",
          bundleChoiceGroups: Array.isArray(product.bundleChoiceGroups)
            ? product.bundleChoiceGroups
            : [],
          isBestSeller: product.isBestSeller === true,
          rank: typeof product.rank === "number" ? product.rank : null,
        })),
      };
      const nextScheduledPickupAt = orderSession.orderingMode === "PREORDER"
        ? orderSession.preorderSlots.includes(scheduledPickupAtRef.current)
          ? scheduledPickupAtRef.current
          : orderSession.preorderSlots[0] ?? ""
        : "";
      const restorableProducts = orderSession.orderingMode === "PREORDER"
        ? publicMenuProductsForPickup(orderSession.products, nextScheduledPickupAt)
        : orderSession.products;
      const nextLocale = preserveSupportedQrLocale(
        localeRef.current,
        orderSession.supportedLocales,
      );
      localeRef.current = nextLocale;
      setLocale(nextLocale);
      try {
        const restored = restoreQrCartDraft(
          window.localStorage.getItem(qrCartStorageKey(qrToken, orderSession.orderingMode)),
          restorableProducts,
          orderSession.limits,
        );
        if (restored) {
          setCartLines(restored.lines);
          setCustomerName(restored.customerName);
          setCustomerNote(restored.customerNote);
          setCustomerPhone(restored.customerPhone ?? "");
          setDeliveryAddress(restored.deliveryAddress ?? "");
          setCartRestored(true);
        }
      } catch {
        // Restricted browser storage must not block ordering.
      }
      sessionReadyRef.current = true;
      if (
        availabilityStatusRef.current === "CHECKING"
        || availabilityStatusRef.current === "UNKNOWN"
      ) {
        updateOrderingAvailability("AVAILABLE");
      }
      setSession(orderSession);
      lastCapacityRefreshAtRef.current = Date.now();
      capacityRefreshStoppedRef.current = false;
      setActiveOrderingMode(orderSession.orderingMode);
      if (orderSession.orderingMode === "PREORDER") {
        scheduledPickupAtRef.current = nextScheduledPickupAt;
        setScheduledPickupAt(nextScheduledPickupAt);
        setLotteryDraw(null);
      }
      setCartReady(true);
      setSessionStartError("");
      setMessage("");
    } catch (error) {
      if (attemptGeneration !== sessionAttemptGenerationRef.current) return;
      sessionReadyRef.current = false;
      if (initialMenu && (
        availabilityStatusRef.current === "CHECKING"
        || availabilityStatusRef.current === "AVAILABLE"
        || availabilityStatusRef.current === "UNKNOWN"
      )) {
        updateOrderingAvailability("UNAVAILABLE");
      }
      const errorMessage = error instanceof LocalizedOrderError
        ? error.message
        : qrOrderMessages[browserLocale].networkError;
      setSessionStartError(errorMessage);
      setMessage(errorMessage);
    } finally {
      if (attemptGeneration === sessionAttemptGenerationRef.current) setIsLoading(false);
    }
  }, [activeOrderingMode, initialMenu, qrToken, updateOrderingAvailability]);

  useEffect(() => {
    if (!cartOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [cartOpen]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const currentDeviceId = getOrCreateDeviceId();
    const preferredLocales = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
    let storedLocale: QrLocale | null = null;
    try {
      const stored = window.localStorage.getItem(QR_LOCALE_STORAGE_KEY);
      storedLocale = stored && isQrLocale(stored) ? stored : null;
    } catch {
      storedLocale = null;
    }
    const browserLocale = storedLocale ?? resolvePreferredQrLocale(preferredLocales, QR_LOCALES);
    localeRef.current = browserLocale;
    setLocale(browserLocale);
    setDeviceId(currentDeviceId);
    void startOrderSession(currentDeviceId, browserLocale);
  }, [startOrderSession]);

  useEffect(() => {
    if (!deviceId) return;
    let disposed = false;

    const refreshAvailability = async (
      retrySession = false,
      forceRefresh = true,
    ) => {
      setAvailabilityRefreshing(true);
      const config = await getPublicAvailability(deviceId, { forceRefresh });
      if (disposed) return;
      setAvailabilityRefreshing(false);
      if (!config) {
        if (!sessionReadyRef.current) updateOrderingAvailability("UNAVAILABLE");
        return;
      }

      const target = `${config.activeBackend}:${config.promotionEpoch}`;
      const targetChanged = availabilityTargetRef.current !== null
        && availabilityTargetRef.current !== target;
      availabilityTargetRef.current = target;

      if (config.qrOrdering !== "AVAILABLE") {
        sessionReadyRef.current = false;
        setSessionStartError("");
        setSession((current) => current ? {
          ...current,
          orderSessionToken: "",
          expiresAt: "",
        } : current);
        setSecondsRemaining(0);
        setTurnstileToken(null);
        setTurnstileRequested(false);
        updateOrderingAvailability(config.qrOrdering);
        return;
      }

      const shouldStartSession = retrySession
        || targetChanged
        || availabilityStatusRef.current === "DEGRADED"
        || availabilityStatusRef.current === "UNAVAILABLE"
        || availabilityStatusRef.current === "MAINTENANCE";
      updateOrderingAvailability("AVAILABLE");
      if (shouldStartSession) {
        if (targetChanged) sessionRequestIdRef.current = crypto.randomUUID();
        await startOrderSession(deviceId, localeRef.current);
      }
    };

    refreshAvailabilityRef.current = (retrySession = false) => (
      void refreshAvailability(retrySession, true)
    );
    void refreshAvailability(false, false);
    const timer = window.setInterval(
      () => void refreshAvailability(false, true),
      10_000,
    );
    return () => {
      disposed = true;
      window.clearInterval(timer);
      refreshAvailabilityRef.current = () => undefined;
    };
  }, [deviceId, startOrderSession, updateOrderingAvailability]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    const updateRemaining = () => {
      const nextSeconds = Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
      secondsRemainingRef.current = nextSeconds;
      setSecondsRemaining(nextSeconds);
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!deviceId || !sessionReady || !session?.orderSessionToken) return;
    let disposed = false;

    const refreshCapacityQuote = async () => {
      const now = Date.now();
      if (capacityRefreshStoppedRef.current || capacityRefreshInFlightRef.current || !shouldRefreshQrCapacity({
        orderingMode: activeOrderingMode,
        sessionReady: sessionReadyRef.current,
        secondsRemaining: secondsRemainingRef.current,
        visibilityState: document.visibilityState,
        sessionRequestId: sessionRequestIdRef.current,
        lastRefreshAt: lastCapacityRefreshAtRef.current,
        now,
      })) return;

      lastCapacityRefreshAtRef.current = now;
      capacityRefreshInFlightRef.current = true;
      try {
        const response = await requestPublicOrder("create-order-session", {
          qrToken,
          deviceId,
          sessionRequestId: sessionRequestIdRef.current,
          orderingMode: activeOrderingMode,
          includeMenu: false,
        });
        const payload = await parseEdgeResponse(response);
        if (disposed) return;
        if (!response.ok) {
          if (shouldRotateSessionRequestId(response.status, String(payload.code ?? ""))) {
            capacityRefreshStoppedRef.current = true;
          }
          return;
        }
        if (payload.orderSessionToken !== session.orderSessionToken) return;
        const nextMinimum = Number(payload.estimatedWaitMinMinutes);
        const nextMaximum = Number(payload.estimatedWaitMaxMinutes);
        const nextThreshold = payload.waitAcknowledgmentThresholdMinutes === null
          ? null
          : Number(payload.waitAcknowledgmentThresholdMinutes);
        const requiresAcknowledgment = payload.requiresWaitAcknowledgment === true;
        if (
          requiresAcknowledgment
          && (
            session.estimatedWaitMinMinutes !== nextMinimum
            || session.estimatedWaitMaxMinutes !== nextMaximum
            || !session.requiresWaitAcknowledgment
          )
        ) setWaitAcknowledged(false);
        setSession((current) => {
          if (!current || current.orderSessionToken !== session.orderSessionToken) return current;
          return {
            ...current,
            estimatedWaitMinutes: Number.isFinite(nextMaximum) ? nextMaximum : current.estimatedWaitMinutes,
            estimatedWaitMinMinutes: Number.isFinite(nextMinimum) ? nextMinimum : current.estimatedWaitMinMinutes,
            estimatedWaitMaxMinutes: Number.isFinite(nextMaximum) ? nextMaximum : current.estimatedWaitMaxMinutes,
            waitAcknowledgmentThresholdMinutes: nextThreshold === null || Number.isFinite(nextThreshold)
              ? nextThreshold
              : current.waitAcknowledgmentThresholdMinutes,
            requiresWaitAcknowledgment: requiresAcknowledgment,
          };
        });
      } catch {
        // A background quote refresh must never interrupt an active cart.
      } finally {
        capacityRefreshInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => void refreshCapacityQuote(), 15_000);
    const handleVisibilityChange = () => void refreshCapacityQuote();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    activeOrderingMode,
    deviceId,
    qrToken,
    session?.estimatedWaitMaxMinutes,
    session?.estimatedWaitMinMinutes,
    session?.orderSessionToken,
    session?.requiresWaitAcknowledgment,
    sessionReady,
  ]);

  useEffect(() => {
    if (!session || !cartReady) return;
    try {
      const hasDraft = cartLines.length > 0
        || customerName.length > 0 || customerNote.length > 0
        || customerPhone.length > 0 || deliveryAddress.length > 0;
      if (!hasDraft) {
        window.localStorage.removeItem(qrCartStorageKey(qrToken, activeOrderingMode));
        return;
      }
      window.localStorage.setItem(qrCartStorageKey(qrToken, activeOrderingMode), serializeQrCartDraft({
        customerName,
        customerNote,
        customerPhone,
        deliveryAddress,
        lines: cartLines,
      }));
    } catch {
      // Restricted browser storage must not block ordering.
    }
  }, [activeOrderingMode, cartLines, cartReady, customerName, customerNote, customerPhone, deliveryAddress, qrToken, session]);

  const visibleProducts = useMemo(() => {
    if (!session) return [];
    return activeOrderingMode === "PREORDER"
      ? publicMenuProductsForPickup(session.products, scheduledPickupAt)
      : session.products;
  }, [activeOrderingMode, scheduledPickupAt, session]);

  const selectedItems = useMemo(() => {
    return cartLines.map(({ productId, quantity, note, noteOptionIds, bundleChoiceIds }) => ({
      productId,
      quantity,
      note,
      noteOptionIds,
      bundleChoiceIds,
    }));
  }, [cartLines]);

  const totalQuantity = qrCartTotalQuantity(cartLines);
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
  const localizedProduct = useCallback((product: Product) => {
    const translation = product.translations.find((item) => item.locale === locale);
    return translation ? { name: translation.name, description: translation.description } : product;
  }, [locale]);
  const localizedGroupName = useCallback((group: NoteGroup) => group.translations.find((item) => item.locale === locale)?.name ?? group.name, [locale]);
  const localizedOptionName = useCallback((option: NoteOption) => option.translations.find((item) => item.locale === locale)?.name ?? option.name, [locale]);
  const bundleChoiceLabel = useCallback((option: BundleChoiceOption) => (
    option.quantity > 1
      ? `${option.componentProductName} × ${option.quantity}`
      : option.componentProductName
  ), []);

  function changeLocale(nextLocale: string) {
    if (!isQrLocale(nextLocale)) return;
    localeRef.current = nextLocale;
    setLocale(nextLocale);
    setMessage("");
    try {
      window.localStorage.setItem(QR_LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Browsers can block storage in private or restricted contexts.
    }
    refreshAvailabilityRef.current();
  }

  const handleTurnstileToken = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  function updateQuantity(productId: string, next: number) {
    if (!session || !orderingEnabled) return;
    const product = visibleProducts.find((candidate) => candidate.id === productId);
    if (!product) return;
    const configurable = product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
    if (!configurable) {
      const currentLine = cartLines.find((line) => line.productId === productId);
      const nextLines = currentLine
        ? updateQrCartLineQuantity(cartLines, currentLine.id, next, session.limits)
        : addQrCartLine(cartLines, {
            productId,
            quantity: next,
            note: "",
            noteOptionIds: [],
            bundleChoiceIds: [],
          }, session.limits, () => crypto.randomUUID());
      if (!nextLines) {
        setMessage(copy.quantityLimit);
        return;
      }
      setCartLines(nextLines);
      if (next > 0) setTurnstileRequested(true);
      setMessage("");
      return;
    }

    const currentDraft = productDrafts[productId] ?? {
      quantity: 0,
      noteOptionIds: [],
      bundleChoiceIds: [],
    };
    const editingLineId = editingLineIds[productId];
    const effectiveLines = editingLineId
      ? cartLines.filter((line) => line.id !== editingLineId)
      : cartLines;
    const distinctProducts = new Set(effectiveLines.map((line) => line.productId));
    const allowedIncrease = next <= currentDraft.quantity
      || (qrCartProductQuantity(effectiveLines, productId) + next <= session.limits.maxItemQuantity
        && qrCartTotalQuantity(effectiveLines) + next <= session.limits.maxTotalQuantity
        && (distinctProducts.has(productId) || distinctProducts.size < session.limits.maxUniqueProducts));
    if (!allowedIncrease) {
      setMessage(copy.quantityLimit);
      return;
    }
    setMessage("");
    setProductDrafts((drafts) => {
      if (next <= 0) {
        const nextDrafts = { ...drafts };
        delete nextDrafts[productId];
        return nextDrafts;
      }
      return { ...drafts, [productId]: { ...currentDraft, quantity: next } };
    });
  }

  function selectNoteOption(productId: string, group: NoteGroup, optionId: string | null) {
    if (!orderingEnabled) return;
    setMessage("");
    setProductDrafts((drafts) => {
      const draft = drafts[productId];
      if (!draft) return drafts;
      return {
        ...drafts,
        [productId]: {
          ...draft,
          noteOptionIds: toggleNoteOption(draft.noteOptionIds, group, optionId),
        },
      };
    });
  }

  function selectBundleChoice(productId: string, group: BundleChoiceGroup, choiceId: string | null) {
    if (!orderingEnabled) return;
    setMessage("");
    setProductDrafts((drafts) => {
      const draft = drafts[productId];
      if (!draft) return drafts;
      return {
        ...drafts,
        [productId]: {
          ...draft,
          bundleChoiceIds: toggleBundleChoice(draft.bundleChoiceIds, group, choiceId),
        },
      };
    });
  }

  function addProductDraft(product: Product) {
    if (!session || !orderingEnabled) return;
    const draft = productDrafts[product.id];
    if (!draft || draft.quantity <= 0) return;
    if (
      !noteSelectionIsValid(product.noteGroups, draft.noteOptionIds)
      || !bundleSelectionIsValid(product.bundleChoiceGroups, draft.bundleChoiceIds)
    ) {
      setMessage(copy.requiredNotes(localizedProduct(product).name));
      return;
    }
    const editingLineId = editingLineIds[product.id];
    const effectiveLines = editingLineId
      ? cartLines.filter((line) => line.id !== editingLineId)
      : cartLines;
    const nextLines = addQrCartLine(effectiveLines, {
      productId: product.id,
      quantity: draft.quantity,
      note: "",
      noteOptionIds: draft.noteOptionIds,
      bundleChoiceIds: draft.bundleChoiceIds,
    }, session.limits, () => crypto.randomUUID());
    if (!nextLines) {
      setMessage(copy.quantityLimit);
      return;
    }
    setCartLines(nextLines);
    setProductDrafts((drafts) => {
      const nextDrafts = { ...drafts };
      delete nextDrafts[product.id];
      return nextDrafts;
    });
    setEditingLineIds((lineIds) => {
      const nextLineIds = { ...lineIds };
      delete nextLineIds[product.id];
      return nextLineIds;
    });
    setTurnstileRequested(true);
    setMessage("");
  }

  function changeCartLineQuantity(lineId: string, quantity: number) {
    if (!session || !orderingEnabled) return;
    const nextLines = updateQrCartLineQuantity(cartLines, lineId, quantity, session.limits);
    if (!nextLines) {
      setMessage(copy.quantityLimit);
      return;
    }
    setCartLines(nextLines);
    const changedLine = cartLines.find((line) => line.id === lineId);
    if (changedLine && editingLineIds[changedLine.productId] === lineId) {
      if (quantity <= 0) {
        setProductDrafts((drafts) => {
          const nextDrafts = { ...drafts };
          delete nextDrafts[changedLine.productId];
          return nextDrafts;
        });
        setEditingLineIds((lineIds) => {
          const nextLineIds = { ...lineIds };
          delete nextLineIds[changedLine.productId];
          return nextLineIds;
        });
      } else {
        setProductDrafts((drafts) => drafts[changedLine.productId]
          ? { ...drafts, [changedLine.productId]: { ...drafts[changedLine.productId], quantity } }
          : drafts);
      }
    }
    setMessage("");
  }

  function editCartLine(line: QrCartLine) {
    setProductDrafts((drafts) => ({
      ...drafts,
      [line.productId]: {
        quantity: line.quantity,
        noteOptionIds: line.noteOptionIds,
        bundleChoiceIds: line.bundleChoiceIds,
      },
    }));
    setEditingLineIds((lineIds) => ({ ...lineIds, [line.productId]: line.id }));
    setCartOpen(false);
    window.setTimeout(() => document.getElementById(`qr-product-${line.productId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    }), 0);
  }

  function changeScheduledPickupAt(nextScheduledPickupAt: string) {
    if (!session || !session.preorderSlots.includes(nextScheduledPickupAt)) return;
    const availableProducts = publicMenuProductsForPickup(
      session.products,
      nextScheduledPickupAt,
    );
    scheduledPickupAtRef.current = nextScheduledPickupAt;
    setScheduledPickupAt(nextScheduledPickupAt);
    const nextCartLines = prunePublicCartLinesForProducts(availableProducts, cartLines);
    setCartLines(nextCartLines);
    setProductDrafts((drafts) => {
      const draftLines = Object.entries(drafts).map(([productId, draft]) => ({
        id: `draft:${productId}`,
        productId,
        note: "",
        ...draft,
      }));
      const nextDrafts = Object.fromEntries(prunePublicCartLinesForProducts(availableProducts, draftLines)
        .map((line) => [line.productId, {
          quantity: line.quantity,
          noteOptionIds: line.noteOptionIds,
          bundleChoiceIds: line.bundleChoiceIds,
        }]));
      for (const line of nextCartLines) {
        const product = availableProducts.find((candidate) => candidate.id === line.productId);
        if (product && (
          !noteSelectionIsValid(product.noteGroups, line.noteOptionIds)
          || !bundleSelectionIsValid(product.bundleChoiceGroups, line.bundleChoiceIds)
        ) && !nextDrafts[line.productId]) {
          nextDrafts[line.productId] = {
            quantity: line.quantity,
            noteOptionIds: line.noteOptionIds,
            bundleChoiceIds: line.bundleChoiceIds,
          };
        }
      }
      return nextDrafts;
    });
    setEditingLineIds((lineIds) => {
      const nextLineIds = Object.fromEntries(Object.entries(lineIds).filter(([, lineId]) => (
        nextCartLines.some((line) => line.id === lineId)
      )));
      for (const line of nextCartLines) {
        const product = availableProducts.find((candidate) => candidate.id === line.productId);
        if (product && (
          !noteSelectionIsValid(product.noteGroups, line.noteOptionIds)
          || !bundleSelectionIsValid(product.bundleChoiceGroups, line.bundleChoiceIds)
        ) && !nextLineIds[line.productId]) nextLineIds[line.productId] = line.id;
      }
      return nextLineIds;
    });
    setLotteryDraw(null);
    setMessage("");
  }

  async function drawLottery() {
    if (!sessionReady || !session || !deviceId || isDrawingLottery) return;
    setIsDrawingLottery(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/lottery-draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderSessionToken: session.orderSessionToken,
          deviceId,
        }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(payload.error ?? "抽抽樂目前無法使用。"));
      const draw: LotteryDraw = {
        drawId: String(payload.drawId),
        productId: String(payload.productId),
        productName: String(payload.productName),
        discountWon: payload.discountWon === true,
        discountLabel: typeof payload.discountLabel === "string" ? payload.discountLabel : null,
      };
      if (!visibleProducts.some((product) => product.id === draw.productId)) {
        throw new Error("抽中的商品目前無法供應，請稍後再試。");
      }
      setLotteryDraw(draw);
      const product = visibleProducts.find((candidate) => candidate.id === draw.productId);
      const currentQuantity = product && (product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0)
        ? productDrafts[draw.productId]?.quantity ?? 0
        : qrCartProductQuantity(cartLines, draw.productId);
      updateQuantity(draw.productId, Math.max(1, currentQuantity));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "抽抽樂目前無法使用。");
    } finally {
      setIsDrawingLottery(false);
    }
  }

  async function submitOrder() {
    if (!orderingEnabled) {
      setMessage(copy.degradedMessage);
      return;
    }
    if (!sessionReady || !session || !deviceId || !turnstileToken || selectedItems.length === 0) {
      setMessage(!sessionReady ? copy.sessionLoading : !turnstileToken ? copy.securityRequired : copy.selectAtLeastOne);
      return;
    }
    if (secondsRemaining <= 0) {
      setMessage(copy.sessionExpired);
      return;
    }
    if (session.requiresWaitAcknowledgment && !waitAcknowledged) {
      setMessage(copy.waitAcknowledgmentRequired);
      return;
    }
    if (activeOrderingMode === "DELIVERY" && (!PHONE_NUMBER.test(customerPhone.trim()) || !deliveryAddress.trim())) {
      setMessage(deliveryCopy.detailsRequired);
      return;
    }
    if (activeOrderingMode === "PREORDER" && !scheduledPickupAt) {
      setMessage("請先選擇預約取餐時間。");
      return;
    }
    const invalidLine = cartLines.find((line) => {
      const product = visibleProducts.find((candidate) => candidate.id === line.productId);
      return !product
        || !noteSelectionIsValid(product.noteGroups, line.noteOptionIds)
        || !bundleSelectionIsValid(product.bundleChoiceGroups, line.bundleChoiceIds);
    });
    if (invalidLine) {
      const invalidProduct = visibleProducts.find((product) => product.id === invalidLine.productId);
      setMessage(invalidProduct
        ? copy.requiredNotes(localizedProduct(invalidProduct).name)
        : copy.errors.productUnavailable);
      return;
    }

    const fingerprint = JSON.stringify({ orderingMode: activeOrderingMode, customerName, customerPhone, deliveryAddress, customerNote, scheduledPickupAt, lotteryDrawId: lotteryDraw?.drawId ?? null, selectedItems, waitAcknowledged });
    if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
      idempotencyRef.current = {
        key: crypto.randomUUID(),
        clientOrderId: crypto.randomUUID(),
        turnstileIdempotencyKey: crypto.randomUUID(),
        fingerprint,
      };
    }

    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await requestPublicOrder("create-public-order", {
        qrToken,
        orderSessionToken: session.orderSessionToken,
        deviceId,
        idempotencyKey: idempotencyRef.current.key,
        clientOrderId: idempotencyRef.current.clientOrderId,
        turnstileIdempotencyKey: idempotencyRef.current.turnstileIdempotencyKey,
        customerName,
        customerPhone,
        deliveryAddress,
        customerNote,
        waitAcknowledged,
        orderingMode: activeOrderingMode,
        scheduledPickupAt: activeOrderingMode === "PREORDER" ? scheduledPickupAt : null,
        lotteryDrawId: lotteryDraw?.drawId ?? null,
        items: selectedItems,
        turnstileToken,
      });
      const payload = await parseEdgeResponse(response);
      if (!response.ok) {
        const code = String(payload.code ?? "");
        if (code === "WAIT_ACKNOWLEDGMENT_REQUIRED") {
          const capacity = payload.capacity && typeof payload.capacity === "object"
            ? payload.capacity as Record<string, unknown>
            : null;
          setSession((current) => current ? {
            ...current,
            estimatedWaitMinutes: Number(capacity?.estimatedWaitMaxMinutes ?? current.estimatedWaitMinutes),
            estimatedWaitMinMinutes: Number(capacity?.estimatedWaitMinMinutes ?? current.estimatedWaitMinMinutes),
            estimatedWaitMaxMinutes: Number(capacity?.estimatedWaitMaxMinutes ?? current.estimatedWaitMaxMinutes),
            requiresWaitAcknowledgment: true,
          } : current);
          setWaitAcknowledged(false);
        }
        if (code === "INVALID_TURNSTILE") {
          idempotencyRef.current = null;
          setTurnstileToken(null);
          setTurnstileResetKey((value) => value + 1);
        }
        throw new LocalizedOrderError(
          localizedDeliveryOrderError(locale, code) ?? localizedPublicOrderError(locale, code),
        );
      }

      const trackingToken = String(payload.trackingToken);
      try {
        window.localStorage.removeItem(qrCartStorageKey(qrToken, activeOrderingMode));
      } catch {
        // The order already succeeded; storage cleanup is best effort.
      }
      window.location.assign(`/order/${encodeURIComponent(trackingToken)}`);
    } catch (error) {
      setMessage(error instanceof LocalizedOrderError ? error.message : copy.networkError);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <main className="grid min-h-screen place-items-center px-5 text-sm text-stone-600">{copy.sessionLoading}</main>;
  }

  if (!session) {
    return (
      <main className="mx-auto min-h-screen max-w-lg px-5 py-16">
        <ShieldCheck className="h-8 w-8 text-red-700" />
        <h1 className="mt-4 text-2xl font-semibold">{copy.qrUnavailableTitle}</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-stone-600">{message}</p>
      </main>
    );
  }

  const availableLocales = QR_LOCALES.filter((candidate) => (
    candidate === "zh-TW" || session.supportedLocales.includes(candidate)
  ));
  const cartPanel = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 id="qr-cart-heading" className="text-lg font-semibold">{copy.yourOrder}</h2>
        <button
          type="button"
          title={copy.close}
          aria-label={copy.close}
          onClick={() => setCartOpen(false)}
          className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 md:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {cartLines.length > 0 ? (
        <div data-testid="qr-cart-lines" className="mt-4 space-y-3 border-b border-stone-200 pb-4">
          {cartLines.map((line, index) => {
            const product = session.products.find((candidate) => candidate.id === line.productId);
            if (!product) return null;
            const productCopy = localizedProduct(product);
            const noteLabels = product.noteGroups.flatMap((group) => group.options)
              .filter((option) => line.noteOptionIds.includes(option.id))
              .map(localizedOptionName);
            const bundleLabels = product.bundleChoiceGroups.flatMap((group) => group.options)
              .filter((option) => line.bundleChoiceIds.includes(option.id))
              .map(bundleChoiceLabel);
            const unitPrice = Math.max(
              0,
              product.price
                + notePriceAdjustment(product.noteGroups, line.noteOptionIds)
                + bundlePriceAdjustment(product.bundleChoiceGroups, line.bundleChoiceIds),
            );
            const configurable = product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
            return (
              <article
                key={line.id}
                data-testid="qr-cart-line"
                data-product-id={line.productId}
                className="rounded-md border border-stone-200 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{productCopy.name}</h3>
                    {[...noteLabels, ...bundleLabels].length > 0 ? (
                      <p className="mt-1 text-xs leading-5 text-stone-600">{[...noteLabels, ...bundleLabels].join("、")}</p>
                    ) : null}
                  </div>
                  <strong className="shrink-0 text-sm">{formatMoney(unitPrice * line.quantity, session.stall.currency, locale)}</strong>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" aria-label={copy.decrease(`${productCopy.name} ${index + 1}`)} disabled={!orderingEnabled} onClick={() => changeCartLineQuantity(line.id, line.quantity - 1)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                  <span className="min-w-7 text-center text-sm font-semibold">{line.quantity}</span>
                  <button type="button" aria-label={copy.increase(`${productCopy.name} ${index + 1}`)} disabled={!orderingEnabled} onClick={() => changeCartLineQuantity(line.id, line.quantity + 1)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                  <span className="flex-1" />
                  {configurable ? <button type="button" disabled={!orderingEnabled} onClick={() => editCartLine(line)} className="min-h-10 rounded-md px-2 text-xs font-semibold text-teal-800 disabled:opacity-40">{copy.editCartItem}</button> : null}
                  <button type="button" disabled={!orderingEnabled} onClick={() => changeCartLineQuantity(line.id, 0)} className="min-h-10 rounded-md px-2 text-xs font-semibold text-red-700 disabled:opacity-40">{copy.removeCartItem}</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        <input
          type="text"
          autoComplete="name"
          enterKeyHint="next"
          aria-label={copy.customerName}
          className="form-input"
          placeholder={copy.customerNamePlaceholder}
          maxLength={50}
          value={customerName}
          disabled={!orderingEnabled}
          onChange={(event) => setCustomerName(event.target.value)}
        />
        {session.stall.fulfillmentType === "DELIVERY" ? (
          <>
            <input
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="next"
              aria-label={deliveryCopy.phone}
              className="form-input"
              placeholder={deliveryCopy.phonePlaceholder}
              maxLength={30}
              pattern="\+?[0-9][0-9 ().-]{5,29}"
              value={customerPhone}
              disabled={!orderingEnabled}
              onChange={(event) => setCustomerPhone(event.target.value)}
            />
            <textarea
              required
              autoComplete="street-address"
              aria-label={deliveryCopy.address}
              className="form-input min-h-24"
              placeholder={deliveryCopy.addressPlaceholder}
              maxLength={300}
              value={deliveryAddress}
              disabled={!orderingEnabled}
              onChange={(event) => setDeliveryAddress(event.target.value)}
            />
          </>
        ) : null}
        {activeOrderingMode === "PREORDER" ? (
          <label className="block text-sm font-semibold text-stone-700">
            預約取餐時間
            <select
              required
              aria-label="預約取餐時間"
              value={scheduledPickupAt}
              disabled={!orderingEnabled}
              onChange={(event) => changeScheduledPickupAt(event.target.value)}
              className="form-input mt-1 bg-white"
            >
              {session.preorderSlots.map((slot) => (
                <option key={slot} value={slot}>
                  {formatPreorderSlot(slot, locale, session.stall.timezone)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <textarea
          aria-label={copy.orderNote}
          className="form-input min-h-20"
          placeholder={copy.orderNotePlaceholder(session.limits.maxNoteLength)}
          maxLength={session.limits.maxNoteLength}
          value={customerNote}
          disabled={!orderingEnabled}
          onChange={(event) => setCustomerNote(event.target.value)}
        />
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-stone-200 pt-4">
        <span className="text-sm text-stone-600">{copy.itemCount(totalQuantity)}</span>
        <strong>{formatMoney(total, session.stall.currency, locale)}</strong>
      </div>
      {session.requiresWaitAcknowledgment ? (
        <label className="mt-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={waitAcknowledged}
            disabled={!orderingEnabled}
            onChange={(event) => {
              setWaitAcknowledged(event.target.checked);
              setMessage("");
            }}
          />
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{copy.waitAcknowledgment(session.estimatedWaitMinMinutes, session.estimatedWaitMaxMinutes)}</span>
        </label>
      ) : null}
      <div className="mt-4 min-h-16">
        {turnstileRequested && orderingEnabled ? (
          <TurnstileWidget
            resetKey={turnstileResetKey}
            locale={locale}
            label={copy.securityVerification}
            missingKeyMessage={copy.securityNotConfigured}
            onToken={handleTurnstileToken}
          />
        ) : null}
      </div>
      <button type="button" disabled={!orderingEnabled || isSubmitting || totalQuantity === 0 || !turnstileToken || secondsRemaining <= 0 || (session.requiresWaitAcknowledgment && !waitAcknowledged)} onClick={submitOrder} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        <Send className="h-4 w-4" />
        {isSubmitting ? copy.submitting : copy.submitOrder}
      </button>
      <p className="mt-3 text-xs leading-5 text-stone-500">{copy.confirmationNotice}</p>
      {message ? <p role="alert" className="mt-3 text-sm text-red-700">{message}</p> : null}
    </>
  );

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl gap-6 px-4 py-5 pb-28 md:grid-cols-[minmax(0,1fr)_340px] md:px-8 md:pb-5">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm font-medium text-teal-800">{session.stall.location}</p><h1 className="mt-1 text-3xl font-semibold">{session.stall.name}</h1></div>
          <QrLanguageSelector locale={locale} locales={availableLocales} label={copy.language} menuLabel={copy.menuLanguage} onChange={changeLocale} />
        </div>
        <p className="mt-2 text-sm font-semibold text-stone-700">{session.stall.fulfillmentType === "DINE_IN" ? copy.dineIn(session.stall.table?.label ?? "") : session.stall.fulfillmentType === "DELIVERY" ? deliveryCopy.delivery : copy.takeout}</p>
        {activeOrderingMode === "PREORDER" ? <p className="mt-2 rounded-md bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900">目前為非營業時間，僅接受預約外帶。</p> : null}
        {degradedMode ? (
          <div role="alert" className="mt-4 border-y border-amber-300 bg-amber-50 px-3 py-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{copy.degradedTitle}</h2>
                <p className="mt-1 text-sm leading-6">
                  {orderingAvailability === "UNAVAILABLE" && !sessionReady && sessionStartError
                    ? sessionStartError
                    : copy.degradedMessage}
                </p>
              </div>
              <button
                type="button"
                aria-label={copy.retryAvailability}
                disabled={availabilityRefreshing}
                onClick={() => refreshAvailabilityRef.current(true)}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-amber-400 bg-white px-3 text-xs font-semibold disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${availabilityRefreshing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{copy.retryAvailability}</span>
              </button>
            </div>
          </div>
        ) : null}
        <div
          data-testid="qr-session-status"
          data-ordering-availability={orderingAvailability}
          className="mt-3 inline-flex items-center gap-2 text-sm text-stone-600"
        >
          <Clock3 className="h-4 w-4" />
          {sessionReady
            ? copy.timeRemaining(Math.floor(secondsRemaining / 60), String(secondsRemaining % 60).padStart(2, "0"))
            : degradedMode ? copy.degradedTitle : copy.sessionLoading}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-y border-stone-200 py-3 text-sm text-stone-700">
          <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-teal-700" />{activeOrderingMode === "PREORDER" ? "請依選擇的預約時段取餐" : copy.estimatedWaitRange(session.estimatedWaitMinMinutes, session.estimatedWaitMaxMinutes)}</span>
          {session.lastTableOrderAt ? <span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-stone-500" />{copy.lastTableOrder(new Date(session.lastTableOrderAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))}</span> : null}
        </div>
        {cartRestored ? <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{copy.cartRestored}</p> : null}

        {session.lotteryEnabled && activeOrderingMode === "DEFAULT" ? (
          <section className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-4" aria-label="抽抽樂推薦">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-semibold text-violet-950">不知道吃什麼？幫我抽</h2><p className="mt-1 text-sm text-violet-800">每天一次商品推薦，還可能抽中結帳折扣。</p></div>
              <button type="button" disabled={!orderingEnabled || isDrawingLottery} onClick={() => void drawLottery()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Dices className="h-4 w-4" />{isDrawingLottery ? "抽取中…" : lotteryDraw ? "查看今日結果" : "開始抽抽樂"}</button>
            </div>
            {lotteryDraw ? <p role="status" className="mt-3 text-sm font-semibold text-violet-950">推薦你吃「{lotteryDraw.productName}」{lotteryDraw.discountWon && lotteryDraw.discountLabel ? `，並抽中 ${lotteryDraw.discountLabel}！` : "。"}</p> : null}
          </section>
        ) : null}

        <nav aria-label={copy.categoryNavigation} className="sticky top-0 z-20 -mx-4 mt-5 flex gap-2 overflow-x-auto border-y border-stone-200 bg-stone-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:border-x-0 md:bg-transparent md:px-0">
          {categories.map((category, index) => (
            <a key={category} href={`#qr-category-${index}`} className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700">
              {localizedQrCategory(locale, category)}
            </a>
          ))}
        </nav>

        <div className="mt-6 space-y-7">
          {activeOrderingMode === "PREORDER" && visibleProducts.length === 0 ? (
            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
              此時段暫無可預約商品，請選擇其他取餐時間。
            </p>
          ) : null}
          {categories.map((category, categoryIndex) => (
            <section key={category} id={`qr-category-${categoryIndex}`} className="scroll-mt-16">
              <h2 className="mb-3 text-sm font-semibold text-stone-500">{localizedQrCategory(locale, category)}</h2>
              <div className="grid gap-3">
                {visibleProducts.filter((product) => product.category === category).map((product) => {
                  const configurable = product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
                  const draft = productDrafts[product.id] ?? {
                    quantity: 0,
                    noteOptionIds: [],
                    bundleChoiceIds: [],
                  };
                  const committedQuantity = qrCartProductQuantity(cartLines, product.id);
                  const displayedQuantity = configurable ? draft.quantity : committedQuantity;
                  return (
                  <article
                    key={product.id}
                    id={`qr-product-${product.id}`}
                    data-best-seller-rank={product.rank ?? undefined}
                    className="rounded-lg border border-stone-200 bg-white p-4"
                  >
                    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-4">
                      {product.imageUrl ? <ProductImage src={product.imageUrl} alt={copy.productImage(localizedProduct(product).name)} width={80} height={80} sizes="(max-width: 639px) 64px, 80px" className="h-16 w-16 shrink-0 rounded-md object-cover sm:h-20 sm:w-20" /> : <div aria-hidden="true" className="h-16 w-16 rounded-md bg-stone-100 sm:h-20 sm:w-20" />}
                      <div className="min-w-0 flex-1">
                        {product.isBestSeller ? <span data-testid="best-seller-badge" className="mb-1 inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">熱銷推薦</span> : null}
                        <h3 className="font-semibold">{localizedProduct(product).name}</h3>
                        <p className="mt-1 text-sm leading-6 text-stone-600">{localizedProduct(product).description}</p>
                        <p className="mt-2 font-semibold">{formatMoney(Math.max(
                          0,
                          product.price
                            + notePriceAdjustment(product.noteGroups, draft.noteOptionIds)
                            + bundlePriceAdjustment(product.bundleChoiceGroups, draft.bundleChoiceIds),
                        ), session.stall.currency, locale)}</p>
                        {configurable && committedQuantity > 0 ? <p className="mt-1 text-xs font-medium text-teal-800">{copy.cartProductQuantity(committedQuantity)}</p> : null}
                      </div>
                      <div className="col-span-2 grid grid-cols-[44px_32px_44px] items-center justify-self-end gap-2 sm:col-span-1">
                        <button type="button" title={copy.decrease(localizedProduct(product).name)} aria-label={copy.decrease(localizedProduct(product).name)} disabled={!orderingEnabled || displayedQuantity <= 0} onClick={() => updateQuantity(product.id, displayedQuantity - 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 disabled:opacity-40">
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="text-center font-semibold">{displayedQuantity}</span>
                        <button type="button" title={copy.increase(localizedProduct(product).name)} aria-label={copy.increase(localizedProduct(product).name)} disabled={!orderingEnabled} onClick={() => updateQuantity(product.id, displayedQuantity + 1)} className="grid h-11 w-11 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-40">
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {draft.quantity > 0 && product.noteGroups.length > 0 ? (
                      <div className="mt-4 space-y-4 border-t border-stone-200 pt-4">
                        {product.noteGroups.map((group) => {
                          const groupOptionIds = new Set(group.options.map((option) => option.id));
                          const selectedCount = draft.noteOptionIds.filter((id) => groupOptionIds.has(id)).length;
                          const maximumReached = group.maxSelections !== null && selectedCount >= group.maxSelections;
                          return (
                            <fieldset key={group.id}>
                              <legend className="text-sm font-semibold text-stone-700">{localizedGroupName(group)}{group.isRequired ? " *" : ""}<span className="ml-2 text-xs font-normal text-stone-500">{group.selectionMode === "SINGLE" ? copy.singleChoice : group.maxSelections ? copy.maxSelections(group.maxSelections) : copy.multipleChoice}</span></legend>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                                {group.selectionMode === "SINGLE" && !group.isRequired ? <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="radio" name={`note-${product.id}-${group.id}`} checked={selectedCount === 0} disabled={!orderingEnabled} onChange={() => selectNoteOption(product.id, group, null)} />{copy.noSelection}</label> : null}
                                {group.options.map((option) => {
                                  const checked = draft.noteOptionIds.includes(option.id);
                                  return <label key={option.id} className="inline-flex min-h-9 items-center gap-2 text-sm"><input type={group.selectionMode === "SINGLE" ? "radio" : "checkbox"} name={`note-${product.id}-${group.id}`} checked={checked} disabled={!orderingEnabled || (group.selectionMode === "MULTIPLE" && maximumReached && !checked)} onChange={() => selectNoteOption(product.id, group, option.id)} /><span>{localizedOptionName(option)}</span>{option.priceDelta !== 0 ? <span className="text-xs text-stone-500">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, session.stall.currency, locale)}</span> : null}</label>;
                                })}
                              </div>
                            </fieldset>
                          );
                        })}
                      </div>
                    ) : null}
                    {draft.quantity > 0 && (product.bundleChoiceGroups?.length ?? 0) > 0 ? (
                      <div className="mt-4 space-y-4 border-t border-stone-200 pt-4">
                        {(product.bundleChoiceGroups ?? []).map((group) => {
                          const groupChoiceIds = new Set(group.options.map((option) => option.id));
                          const selected = draft.bundleChoiceIds;
                          const selectedCount = selected.filter((id) => groupChoiceIds.has(id)).length;
                          const maximumReached = selectedCount >= group.maxSelections;
                          return (
                            <fieldset key={group.id}>
                              <legend className="text-sm font-semibold text-stone-700">
                                {group.name}{group.minSelections > 0 ? " *" : ""}
                                <span className="ml-2 text-xs font-normal text-stone-500">
                                  {group.maxSelections === 1
                                    ? "單選"
                                    : `選 ${group.minSelections}～${group.maxSelections} 項`}
                                </span>
                              </legend>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                                {group.maxSelections === 1 && group.minSelections === 0 ? (
                                  <label className="inline-flex min-h-9 items-center gap-2 text-sm">
                                    <input
                                      type="radio"
                                      name={`bundle-${product.id}-${group.id}`}
                                      checked={selectedCount === 0}
                                      disabled={!orderingEnabled}
                                      onChange={() => selectBundleChoice(product.id, group, null)}
                                    />
                                    不選擇
                                  </label>
                                ) : null}
                                {group.options.map((option) => {
                                  const checked = selected.includes(option.id);
                                  return (
                                    <label key={option.id} className="inline-flex min-h-9 items-center gap-2 text-sm">
                                      <input
                                        type={group.maxSelections === 1 ? "radio" : "checkbox"}
                                        name={`bundle-${product.id}-${group.id}`}
                                        checked={checked}
                                        disabled={!orderingEnabled || (group.maxSelections > 1 && maximumReached && !checked)}
                                        onChange={() => selectBundleChoice(product.id, group, option.id)}
                                      />
                                      <span>{bundleChoiceLabel(option)}</span>
                                      {option.priceDelta !== 0 ? (
                                        <span className="text-xs text-stone-500">
                                          {option.priceDelta > 0 ? "+" : ""}
                                          {formatMoney(option.priceDelta, session.stall.currency, locale)}
                                        </span>
                                      ) : null}
                                    </label>
                                  );
                                })}
                              </div>
                            </fieldset>
                          );
                        })}
                      </div>
                    ) : null}
                    {configurable && draft.quantity > 0 ? (
                      <button type="button" onClick={() => addProductDraft(product)} disabled={!orderingEnabled} className="mt-4 min-h-11 w-full rounded-md bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-40">
                        {copy.addToCart}
                      </button>
                    ) : null}
                  </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      {cartOpen ? <button type="button" aria-label={copy.close} onClick={() => setCartOpen(false)} className="fixed inset-0 z-30 bg-black/45 md:hidden" /> : null}
      <aside
        data-testid="qr-cart-panel"
        role={cartOpen ? "dialog" : undefined}
        aria-modal={cartOpen ? true : undefined}
        aria-labelledby="qr-cart-heading"
        className={`${cartOpen ? "safe-area-bottom fixed inset-x-0 bottom-0 z-40 max-h-[88dvh] overflow-y-auto rounded-t-lg border-t border-stone-200 shadow-2xl" : "hidden"} bg-white p-5 md:sticky md:top-5 md:block md:h-fit md:max-h-none md:overflow-visible md:rounded-lg md:border md:shadow-none`}
      >
        {cartPanel}
      </aside>
      {!cartOpen ? (
        <button
          data-testid="qr-back-to-top"
          type="button"
          title={copy.backToTop}
          aria-label={copy.backToTop}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className={`${totalQuantity > 0 ? "bottom-20" : "bottom-4"} fixed right-4 z-20 grid h-11 w-11 place-items-center rounded-full border border-stone-300 bg-white/95 text-stone-800 shadow-lg backdrop-blur hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 md:bottom-5 md:right-96 lg:right-[calc(50vw-8rem)]`}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      ) : null}
      {totalQuantity > 0 && !cartOpen ? (
        <button data-testid="qr-mobile-cart-summary" type="button" onClick={() => setCartOpen(true)} className="safe-area-bottom fixed inset-x-3 bottom-0 z-30 flex min-h-16 items-center gap-3 rounded-t-lg bg-stone-900 px-4 pt-3 text-left text-white shadow-2xl md:hidden">
          <ShoppingCart className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1"><span className="block text-xs text-stone-300">{copy.itemCount(totalQuantity)}</span><strong>{formatMoney(total, session.stall.currency, locale)}</strong></span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold">{copy.viewOrder}<ChevronDown className="h-4 w-4 rotate-180" /></span>
        </button>
      ) : null}
    </main>
  );
}
