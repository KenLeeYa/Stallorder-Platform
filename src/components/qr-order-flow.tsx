"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, History, Minus, Plus, Send, ShieldCheck } from "lucide-react";
import { QrLanguageSelector } from "@/components/qr-language-selector";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { deliveryOrderMessages, localizedDeliveryOrderError } from "@/lib/delivery-order-i18n";
import { formatMoney } from "@/lib/money";
import { notePriceAdjustment, noteSelectionIsValid, toggleNoteOption } from "@/lib/product-note-selection";
import { getOrCreateDeviceId, parseEdgeResponse, publicEdgeHeaders, publicEdgeUrl } from "@/lib/public-order-client";
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

export function QrOrderFlow({ qrToken, orderingMode = "DEFAULT", initialMenu = null }: Props) {
  const startedRef = useRef(false);
  const idempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null);
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
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(!initialMenu);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [locale, setLocale] = useState<QrLocale>("zh-TW");
  const [cartReady, setCartReady] = useState(false);
  const [cartRestored, setCartRestored] = useState(false);
  const copy = qrOrderMessages[locale];
  const deliveryCopy = deliveryOrderMessages[locale];
  const sessionReady = Boolean(session?.orderSessionToken && session.expiresAt);

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
    setLocale(browserLocale);
    setDeviceId(currentDeviceId);

    void fetch(publicEdgeUrl("create-order-session"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...publicEdgeHeaders() },
      body: JSON.stringify({ qrToken, deviceId: currentDeviceId, orderingMode }),
      cache: "no-store",
    }).then(async (response) => {
      const payload = await parseEdgeResponse(response);
      if (!response.ok) {
        const code = String(payload.code ?? "");
        throw new LocalizedOrderError(
          localizedDeliveryOrderError(browserLocale, code) ?? localizedPublicOrderError(browserLocale, code),
        );
      }
      if (payload.resumeOrder && typeof payload.resumeOrder === "object") {
        const trackingToken = String((payload.resumeOrder as Record<string, unknown>).trackingToken ?? "");
        if (!trackingToken) throw new LocalizedOrderError(qrOrderMessages[browserLocale].sessionStartError);
        window.location.replace(`/order/${encodeURIComponent(trackingToken)}`);
        return;
      }
      const orderSession = payload as unknown as OrderSession;
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
      setSession(orderSession);
      setCartReady(true);
    }).catch((error: unknown) => {
      setMessage(error instanceof LocalizedOrderError ? error.message : qrOrderMessages[browserLocale].networkError);
    }).finally(() => setIsLoading(false));
  }, [orderingMode, qrToken]);

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
    if (!session) return;
    const current = quantities[productId] ?? 0;
    const allowedIncrease = next <= current
      || (next <= session.limits.maxItemQuantity
        && totalQuantity - current + next <= session.limits.maxTotalQuantity
        && (current > 0 || selectedItems.length < session.limits.maxUniqueProducts));
    if (!allowedIncrease) {
      setMessage(copy.quantityLimit);
      return;
    }
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
    setMessage("");
    setNoteSelections((values) => ({
      ...values,
      [productId]: toggleNoteOption(values[productId] ?? [], group, optionId),
    }));
  }

  async function submitOrder() {
    if (!sessionReady || !session || !deviceId || !turnstileToken || selectedItems.length === 0) {
      setMessage(!sessionReady ? copy.sessionLoading : !turnstileToken ? copy.securityRequired : copy.selectAtLeastOne);
      return;
    }
    if (secondsRemaining <= 0) {
      setMessage(copy.sessionExpired);
      return;
    }
    if (orderingMode === "DELIVERY" && (customerPhone.trim().length < 6 || !deliveryAddress.trim())) {
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

    const fingerprint = JSON.stringify({ orderingMode, customerName, customerPhone, deliveryAddress, customerNote, selectedItems });
    if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
      idempotencyRef.current = { key: crypto.randomUUID(), fingerprint };
    }

    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await fetch(publicEdgeUrl("create-public-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...publicEdgeHeaders() },
        body: JSON.stringify({
          qrToken,
          orderSessionToken: session.orderSessionToken,
          deviceId,
          idempotencyKey: idempotencyRef.current.key,
          customerName,
          customerPhone,
          deliveryAddress,
          customerNote,
          orderingMode,
          items: selectedItems,
          turnstileToken,
        }),
      });
      const payload = await parseEdgeResponse(response);
      if (!response.ok) {
        const code = String(payload.code ?? "");
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

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl gap-6 px-4 py-5 md:grid-cols-[minmax(0,1fr)_340px] md:px-8">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm font-medium text-teal-800">{session.stall.location}</p><h1 className="mt-1 text-3xl font-semibold">{session.stall.name}</h1></div>
          <QrLanguageSelector locale={locale} locales={availableLocales} label={copy.language} menuLabel={copy.menuLanguage} onChange={changeLocale} />
        </div>
        <p className="mt-2 text-sm font-semibold text-stone-700">{session.stall.fulfillmentType === "DINE_IN" ? copy.dineIn(session.stall.table?.label ?? "") : session.stall.fulfillmentType === "DELIVERY" ? deliveryCopy.delivery : copy.takeout}</p>
        <div className="mt-3 inline-flex items-center gap-2 text-sm text-stone-600">
          <Clock3 className="h-4 w-4" />
          {sessionReady
            ? copy.timeRemaining(Math.floor(secondsRemaining / 60), String(secondsRemaining % 60).padStart(2, "0"))
            : copy.sessionLoading}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-y border-stone-200 py-3 text-sm text-stone-700">
          <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-teal-700" />{copy.estimatedWait(session.estimatedWaitMinutes)}</span>
          {session.lastTableOrderAt ? <span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-stone-500" />{copy.lastTableOrder(new Date(session.lastTableOrderAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))}</span> : null}
        </div>
        {cartRestored ? <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{copy.cartRestored}</p> : null}

        <div className="mt-6 space-y-7">
          {categories.map((category) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold text-stone-500">{localizedQrCategory(locale, category)}</h2>
              <div className="grid gap-3">
                {session.products.filter((product) => product.category === category).map((product) => (
                  <article key={product.id} className="rounded-lg border border-stone-200 bg-white p-4">
                    <div className="flex items-center gap-4">
                      {product.imageUrl ? <div role="img" aria-label={copy.productImage(localizedProduct(product).name)} className="h-20 w-20 shrink-0 rounded-md bg-cover bg-center" style={{ backgroundImage: `url("${product.imageUrl.replaceAll('"', "%22")}")` }} /> : null}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold">{localizedProduct(product).name}</h3>
                        <p className="mt-1 text-sm leading-6 text-stone-600">{localizedProduct(product).description}</p>
                        <p className="mt-2 font-semibold">{formatMoney(Math.max(0, product.price + notePriceAdjustment(product.noteGroups, noteSelections[product.id] ?? [])), session.stall.currency, locale)}</p>
                      </div>
                      <div className="grid grid-cols-[40px_28px_40px] items-center gap-2">
                        <button type="button" title={copy.decrease(localizedProduct(product).name)} aria-label={copy.decrease(localizedProduct(product).name)} disabled={!quantities[product.id]} onClick={() => updateQuantity(product.id, (quantities[product.id] ?? 0) - 1)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-40">
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="text-center font-semibold">{quantities[product.id] ?? 0}</span>
                        <button type="button" title={copy.increase(localizedProduct(product).name)} aria-label={copy.increase(localizedProduct(product).name)} onClick={() => updateQuantity(product.id, (quantities[product.id] ?? 0) + 1)} className="grid h-10 w-10 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-40">
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
                                {group.selectionMode === "SINGLE" && !group.isRequired ? <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="radio" name={`note-${product.id}-${group.id}`} checked={selectedCount === 0} onChange={() => selectNoteOption(product.id, group, null)} />{copy.noSelection}</label> : null}
                                {group.options.map((option) => {
                                  const checked = (noteSelections[product.id] ?? []).includes(option.id);
                                  return <label key={option.id} className="inline-flex min-h-9 items-center gap-2 text-sm"><input type={group.selectionMode === "SINGLE" ? "radio" : "checkbox"} name={`note-${product.id}-${group.id}`} checked={checked} disabled={group.selectionMode === "MULTIPLE" && maximumReached && !checked} onChange={() => selectNoteOption(product.id, group, option.id)} /><span>{localizedOptionName(option)}</span>{option.priceDelta !== 0 ? <span className="text-xs text-stone-500">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, session.stall.currency, locale)}</span> : null}</label>;
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

      <aside className="h-fit rounded-lg border border-stone-200 bg-white p-5 md:sticky md:top-5">
        <h2 className="text-lg font-semibold">{copy.yourOrder}</h2>
        <div className="mt-4 space-y-3">
          <input aria-label={copy.customerName} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" placeholder={copy.customerNamePlaceholder} maxLength={50} value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          {session.stall.fulfillmentType === "DELIVERY" ? (
            <>
              <input required aria-label={deliveryCopy.phone} className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" placeholder={deliveryCopy.phonePlaceholder} maxLength={30} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
              <textarea required aria-label={deliveryCopy.address} className="min-h-20 w-full rounded-md border border-stone-300 px-3 py-2 text-sm" placeholder={deliveryCopy.addressPlaceholder} maxLength={300} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} />
            </>
          ) : null}
          <textarea aria-label={copy.orderNote} className="min-h-20 w-full rounded-md border border-stone-300 px-3 py-2 text-sm" placeholder={copy.orderNotePlaceholder(session.limits.maxNoteLength)} maxLength={session.limits.maxNoteLength} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} />
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-stone-200 pt-4">
          <span className="text-sm text-stone-600">{copy.itemCount(totalQuantity)}</span>
          <strong>{formatMoney(total, session.stall.currency, locale)}</strong>
        </div>
        <div className="mt-4">
          <TurnstileWidget
            resetKey={turnstileResetKey}
            locale={locale}
            label={copy.securityVerification}
            missingKeyMessage={copy.securityNotConfigured}
            onToken={handleTurnstileToken}
          />
        </div>
        <button type="button" disabled={!sessionReady || isSubmitting || totalQuantity === 0 || !turnstileToken || secondsRemaining <= 0} onClick={submitOrder} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Send className="h-4 w-4" />
          {isSubmitting ? copy.submitting : copy.submitOrder}
        </button>
        <p className="mt-3 text-xs leading-5 text-stone-500">{copy.confirmationNotice}</p>
        {message ? <p role="alert" className="mt-3 text-sm text-red-700">{message}</p> : null}
      </aside>
    </main>
  );
}
