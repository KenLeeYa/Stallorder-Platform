"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
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
import { notePriceAdjustment, noteSelectionIsValid, toggleNoteOption } from "@/lib/product-note-selection";
import {
  getPublicAvailability,
  getOrCreateDeviceId,
  parseEdgeResponse,
  requestPublicOrder,
  type PublicAvailabilityStatus,
} from "@/lib/public-order-client";
import { qrCartStorageKey, restoreQrCartDraft, serializeQrCartDraft } from "@/lib/qr-cart";
import type {
  PublicMenu,
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
  orderingMode?: "DEFAULT" | "DELIVERY";
  initialMenu?: PublicMenu | null;
};

class LocalizedOrderError extends Error {}
const PHONE_NUMBER = /^\+?[0-9][0-9 ().-]{5,29}$/;

export function QrOrderFlow({ qrToken, orderingMode = "DEFAULT", initialMenu = null }: Props) {
  const startedRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const sessionRequestIdRef = useRef<string | null>(null);
  const preferredLocalesRef = useRef<readonly string[]>(["zh-TW"]);
  const availabilityTargetRef = useRef<string | null>(null);
  const availabilityStatusRef = useRef<PublicAvailabilityStatus | "CHECKING">("CHECKING");
  const refreshAvailabilityRef = useRef<() => void>(() => undefined);
  const idempotencyRef = useRef<{
    key: string;
    clientOrderId: string;
    turnstileIdempotencyKey: string;
    fingerprint: string;
  } | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [session, setSession] = useState<OrderSession | null>(initialMenu
    ? { ...initialMenu, orderSessionToken: "", expiresAt: "" }
    : null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [noteSelections, setNoteSelections] = useState<Record<string, string[]>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [waitAcknowledged, setWaitAcknowledged] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [turnstileRequested, setTurnstileRequested] = useState(false);
  const [message, setMessage] = useState("");
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
    preferredLocales: readonly string[],
  ) => {
    if (!sessionRequestIdRef.current) sessionRequestIdRef.current = crypto.randomUUID();
    setIsLoading(!initialMenu);
    try {
      const response = await requestPublicOrder("create-order-session", {
        qrToken,
        deviceId: currentDeviceId,
        sessionRequestId: sessionRequestIdRef.current,
        orderingMode,
        includeMenu: !initialMenu,
      });
      const payload = await parseEdgeResponse(response);
      if (!response.ok) {
        const code = String(payload.code ?? "");
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
      const orderSession = initialMenu
        ? { ...initialMenu, ...payload } as OrderSession
        : payload as unknown as OrderSession;
      setLocale((currentLocale) => preserveSupportedQrLocale(
        currentLocale,
        preferredLocales,
        orderSession.supportedLocales,
      ));
      try {
        const restored = restoreQrCartDraft(
          window.localStorage.getItem(qrCartStorageKey(qrToken, orderingMode)),
          orderSession.products,
          orderSession.limits,
        );
        if (restored) {
          setQuantities(restored.quantities);
          setNoteSelections(restored.noteSelections);
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
      setCartReady(true);
      setMessage("");
    } catch (error) {
      sessionReadyRef.current = false;
      if (initialMenu && availabilityStatusRef.current === "CHECKING") {
        updateOrderingAvailability("UNAVAILABLE");
      }
      setMessage(error instanceof LocalizedOrderError
        ? error.message
        : qrOrderMessages[browserLocale].networkError);
    } finally {
      setIsLoading(false);
    }
  }, [initialMenu, orderingMode, qrToken, updateOrderingAvailability]);

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
    preferredLocalesRef.current = preferredLocales;
    let storedLocale: QrLocale | null = null;
    try {
      const stored = window.localStorage.getItem(QR_LOCALE_STORAGE_KEY);
      storedLocale = stored && isQrLocale(stored) ? stored : null;
    } catch {
      storedLocale = null;
    }
    const browserLocale = storedLocale ?? resolvePreferredQrLocale(preferredLocales, QR_LOCALES);
    setLocale(browserLocale);
    setDeviceId(currentDeviceId);
    void startOrderSession(currentDeviceId, browserLocale, preferredLocales);
  }, [startOrderSession]);

  useEffect(() => {
    if (!deviceId) return;
    let disposed = false;

    const refreshAvailability = async (retrySession = false) => {
      setAvailabilityRefreshing(true);
      const config = await getPublicAvailability(deviceId, { forceRefresh: true });
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
        await startOrderSession(deviceId, locale, preferredLocalesRef.current);
      }
    };

    refreshAvailabilityRef.current = () => void refreshAvailability(true);
    void refreshAvailability();
    const timer = window.setInterval(() => void refreshAvailability(), 10_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      refreshAvailabilityRef.current = () => undefined;
    };
  }, [deviceId, locale, startOrderSession, updateOrderingAvailability]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    const updateRemaining = () => {
      setSecondsRemaining(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)));
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session || !cartReady) return;
    try {
      const hasDraft = Object.values(quantities).some((quantity) => quantity > 0)
        || customerName.length > 0 || customerNote.length > 0
        || customerPhone.length > 0 || deliveryAddress.length > 0;
      if (!hasDraft) {
        window.localStorage.removeItem(qrCartStorageKey(qrToken, orderingMode));
        return;
      }
      window.localStorage.setItem(qrCartStorageKey(qrToken, orderingMode), serializeQrCartDraft({
        customerName,
        customerNote,
        customerPhone,
        deliveryAddress,
        quantities,
        noteSelections,
      }));
    } catch {
      // Restricted browser storage must not block ordering.
    }
  }, [cartReady, customerName, customerNote, customerPhone, deliveryAddress, noteSelections, orderingMode, qrToken, quantities, session]);

  const selectedItems = useMemo(() => {
    if (!session) return [];
    return session.products
      .filter((product) => (quantities[product.id] ?? 0) > 0)
      .map((product) => ({ productId: product.id, quantity: quantities[product.id], note: "", noteOptionIds: noteSelections[product.id] ?? [] }));
  }, [noteSelections, quantities, session]);

  const totalQuantity = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const total = session?.products.reduce(
    (sum, product) => sum + Math.max(0, product.price + notePriceAdjustment(product.noteGroups, noteSelections[product.id] ?? [])) * (quantities[product.id] ?? 0),
    0,
  ) ?? 0;
  const categories = session ? [...new Set(session.products.map((product) => product.category))] : [];
  const localizedProduct = useCallback((product: Product) => {
    const translation = product.translations.find((item) => item.locale === locale);
    return translation ? { name: translation.name, description: translation.description } : product;
  }, [locale]);
  const localizedGroupName = useCallback((group: NoteGroup) => group.translations.find((item) => item.locale === locale)?.name ?? group.name, [locale]);
  const localizedOptionName = useCallback((option: NoteOption) => option.translations.find((item) => item.locale === locale)?.name ?? option.name, [locale]);

  function changeLocale(nextLocale: string) {
    if (!isQrLocale(nextLocale)) return;
    setLocale(nextLocale);
    setMessage("");
    try {
      window.localStorage.setItem(QR_LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Browsers can block storage in private or restricted contexts.
    }
  }

  const handleTurnstileToken = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  function updateQuantity(productId: string, next: number) {
    if (!session || !orderingEnabled) return;
    const current = quantities[productId] ?? 0;
    const allowedIncrease = next <= current
      || (next <= session.limits.maxItemQuantity
        && totalQuantity - current + next <= session.limits.maxTotalQuantity
        && (current > 0 || selectedItems.length < session.limits.maxUniqueProducts));
    if (!allowedIncrease) {
      setMessage(copy.quantityLimit);
      return;
    }
    if (next > 0) setTurnstileRequested(true);
    setMessage("");
    setQuantities((values) => ({ ...values, [productId]: Math.max(0, next) }));
    if (next <= 0) {
      setNoteSelections((values) => {
        const nextValues = { ...values };
        delete nextValues[productId];
        return nextValues;
      });
    }
  }

  function selectNoteOption(productId: string, group: NoteGroup, optionId: string | null) {
    if (!orderingEnabled) return;
    setMessage("");
    setNoteSelections((values) => ({
      ...values,
      [productId]: toggleNoteOption(values[productId] ?? [], group, optionId),
    }));
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
    if (orderingMode === "DELIVERY" && (!PHONE_NUMBER.test(customerPhone.trim()) || !deliveryAddress.trim())) {
      setMessage(deliveryCopy.detailsRequired);
      return;
    }
    const invalidProduct = session.products.find((product) =>
      (quantities[product.id] ?? 0) > 0
      && !noteSelectionIsValid(product.noteGroups, noteSelections[product.id] ?? []));
    if (invalidProduct) {
      setMessage(copy.requiredNotes(localizedProduct(invalidProduct).name));
      return;
    }

    const fingerprint = JSON.stringify({ orderingMode, customerName, customerPhone, deliveryAddress, customerNote, selectedItems, waitAcknowledged });
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
        orderingMode,
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
        window.localStorage.removeItem(qrCartStorageKey(qrToken, orderingMode));
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
        {degradedMode ? (
          <div role="alert" className="mt-4 border-y border-amber-300 bg-amber-50 px-3 py-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{copy.degradedTitle}</h2>
                <p className="mt-1 text-sm leading-6">{copy.degradedMessage}</p>
              </div>
              <button
                type="button"
                disabled={availabilityRefreshing}
                onClick={() => refreshAvailabilityRef.current()}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-amber-400 bg-white px-3 text-xs font-semibold disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${availabilityRefreshing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{copy.retryAvailability}</span>
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-3 inline-flex items-center gap-2 text-sm text-stone-600">
          <Clock3 className="h-4 w-4" />
          {sessionReady
            ? copy.timeRemaining(Math.floor(secondsRemaining / 60), String(secondsRemaining % 60).padStart(2, "0"))
            : degradedMode ? copy.degradedTitle : copy.sessionLoading}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-y border-stone-200 py-3 text-sm text-stone-700">
          <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-teal-700" />{copy.estimatedWaitRange(session.estimatedWaitMinMinutes, session.estimatedWaitMaxMinutes)}</span>
          {session.lastTableOrderAt ? <span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-stone-500" />{copy.lastTableOrder(new Date(session.lastTableOrderAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))}</span> : null}
        </div>
        {cartRestored ? <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{copy.cartRestored}</p> : null}

        <nav aria-label={copy.categoryNavigation} className="sticky top-0 z-20 -mx-4 mt-5 flex gap-2 overflow-x-auto border-y border-stone-200 bg-stone-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:border-x-0 md:bg-transparent md:px-0">
          {categories.map((category, index) => (
            <a key={category} href={`#qr-category-${index}`} className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700">
              {localizedQrCategory(locale, category)}
            </a>
          ))}
        </nav>

        <div className="mt-6 space-y-7">
          {categories.map((category, categoryIndex) => (
            <section key={category} id={`qr-category-${categoryIndex}`} className="scroll-mt-16">
              <h2 className="mb-3 text-sm font-semibold text-stone-500">{localizedQrCategory(locale, category)}</h2>
              <div className="grid gap-3">
                {session.products.filter((product) => product.category === category).map((product) => (
                  <article key={product.id} className="rounded-lg border border-stone-200 bg-white p-4">
                    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-4">
                      {product.imageUrl ? <ProductImage src={product.imageUrl} alt={copy.productImage(localizedProduct(product).name)} width={80} height={80} sizes="(max-width: 639px) 64px, 80px" className="h-16 w-16 shrink-0 rounded-md object-cover sm:h-20 sm:w-20" /> : <div aria-hidden="true" className="h-16 w-16 rounded-md bg-stone-100 sm:h-20 sm:w-20" />}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold">{localizedProduct(product).name}</h3>
                        <p className="mt-1 text-sm leading-6 text-stone-600">{localizedProduct(product).description}</p>
                        <p className="mt-2 font-semibold">{formatMoney(Math.max(0, product.price + notePriceAdjustment(product.noteGroups, noteSelections[product.id] ?? [])), session.stall.currency, locale)}</p>
                      </div>
                      <div className="col-span-2 grid grid-cols-[44px_32px_44px] items-center justify-self-end gap-2 sm:col-span-1">
                        <button type="button" title={copy.decrease(localizedProduct(product).name)} aria-label={copy.decrease(localizedProduct(product).name)} disabled={!orderingEnabled || !quantities[product.id]} onClick={() => updateQuantity(product.id, (quantities[product.id] ?? 0) - 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 disabled:opacity-40">
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="text-center font-semibold">{quantities[product.id] ?? 0}</span>
                        <button type="button" title={copy.increase(localizedProduct(product).name)} aria-label={copy.increase(localizedProduct(product).name)} disabled={!orderingEnabled} onClick={() => updateQuantity(product.id, (quantities[product.id] ?? 0) + 1)} className="grid h-11 w-11 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-40">
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {(quantities[product.id] ?? 0) > 0 && product.noteGroups.length > 0 ? (
                      <div className="mt-4 space-y-4 border-t border-stone-200 pt-4">
                        {product.noteGroups.map((group) => {
                          const groupOptionIds = new Set(group.options.map((option) => option.id));
                          const selectedCount = (noteSelections[product.id] ?? []).filter((id) => groupOptionIds.has(id)).length;
                          const maximumReached = group.maxSelections !== null && selectedCount >= group.maxSelections;
                          return (
                            <fieldset key={group.id}>
                              <legend className="text-sm font-semibold text-stone-700">{localizedGroupName(group)}{group.isRequired ? " *" : ""}<span className="ml-2 text-xs font-normal text-stone-500">{group.selectionMode === "SINGLE" ? copy.singleChoice : group.maxSelections ? copy.maxSelections(group.maxSelections) : copy.multipleChoice}</span></legend>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                                {group.selectionMode === "SINGLE" && !group.isRequired ? <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="radio" name={`note-${product.id}-${group.id}`} checked={selectedCount === 0} disabled={!orderingEnabled} onChange={() => selectNoteOption(product.id, group, null)} />{copy.noSelection}</label> : null}
                                {group.options.map((option) => {
                                  const checked = (noteSelections[product.id] ?? []).includes(option.id);
                                  return <label key={option.id} className="inline-flex min-h-9 items-center gap-2 text-sm"><input type={group.selectionMode === "SINGLE" ? "radio" : "checkbox"} name={`note-${product.id}-${group.id}`} checked={checked} disabled={!orderingEnabled || (group.selectionMode === "MULTIPLE" && maximumReached && !checked)} onChange={() => selectNoteOption(product.id, group, option.id)} /><span>{localizedOptionName(option)}</span>{option.priceDelta !== 0 ? <span className="text-xs text-stone-500">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, session.stall.currency, locale)}</span> : null}</label>;
                                })}
                              </div>
                            </fieldset>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                ))}
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
