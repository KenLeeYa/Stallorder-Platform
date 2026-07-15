"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Minus, Plus, Send, ShieldCheck } from "lucide-react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { formatMoney } from "@/lib/money";
import { notePriceAdjustment, noteSelectionIsValid, toggleNoteOption } from "@/lib/product-note-selection";
import { getOrCreateDeviceId, parseEdgeResponse, publicEdgeUrl } from "@/lib/public-order-client";

type NoteOption = {
  id: string;
  name: string;
  priceDelta: number;
  sortOrder: number;
  translations: Array<{ locale: string; name: string }>;
};
type NoteGroup = {
  id: string;
  name: string;
  selectionMode: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  sortOrder: number;
  translations: Array<{ locale: string; name: string }>;
  options: NoteOption[];
};

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string | null;
  translations: Array<{ locale: string; name: string; description: string }>;
  noteGroups: NoteGroup[];
};

type OrderSession = {
  orderSessionToken: string;
  expiresAt: string;
  stall: {
    name: string;
    slug: string;
    location: string;
    currency: string;
    fulfillmentType: "TAKEOUT" | "DINE_IN";
    table: { id: string; code: string; label: string } | null;
  };
  products: Product[];
  supportedLocales: string[];
  limits: {
    maxItemQuantity: number;
    maxUniqueProducts: number;
    maxTotalQuantity: number;
    maxNoteLength: number;
  };
};

type Props = { qrToken: string };

const localeLabels: Record<string, string> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  vi: "Tiếng Việt",
  th: "ไทย",
};

export function QrOrderFlow({ qrToken }: Props) {
  const startedRef = useRef(false);
  const idempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [session, setSession] = useState<OrderSession | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [noteSelections, setNoteSelections] = useState<Record<string, string[]>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [locale, setLocale] = useState("zh-TW");

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const currentDeviceId = getOrCreateDeviceId();
    setDeviceId(currentDeviceId);

    void fetch(publicEdgeUrl("create-order-session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrToken, deviceId: currentDeviceId }),
      cache: "no-store",
    }).then(async (response) => {
      const payload = await parseEdgeResponse(response);
      if (!response.ok) throw new Error(String(payload.error ?? "目前無法開始點餐。"));
      setSession(payload as unknown as OrderSession);
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "目前無法開始點餐。");
    }).finally(() => setIsLoading(false));
  }, [qrToken]);

  useEffect(() => {
    if (!session) return;
    const updateRemaining = () => {
      setSecondsRemaining(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)));
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

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
      setMessage("已達本攤位的點餐數量限制。");
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
    if (!session || !deviceId || !turnstileToken || selectedItems.length === 0) {
      setMessage(!turnstileToken ? "請先完成安全驗證。" : "請至少選擇一項商品。");
      return;
    }
    if (secondsRemaining <= 0) {
      setMessage("點餐工作階段已逾時，請重新掃描 QR Code。");
      return;
    }
    const invalidProduct = session.products.find((product) =>
      (quantities[product.id] ?? 0) > 0
      && !noteSelectionIsValid(product.noteGroups, noteSelections[product.id] ?? []));
    if (invalidProduct) {
      setMessage(`請完成「${localizedProduct(invalidProduct).name}」的必選註記。`);
      return;
    }

    const fingerprint = JSON.stringify({ customerName, customerNote, selectedItems });
    if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
      idempotencyRef.current = { key: crypto.randomUUID(), fingerprint };
    }

    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await fetch(publicEdgeUrl("create-public-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrToken,
          orderSessionToken: session.orderSessionToken,
          deviceId,
          idempotencyKey: idempotencyRef.current.key,
          customerName,
          customerNote,
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
        throw new Error(String(payload.error ?? "目前無法送出訂單。"));
      }

      const trackingToken = String(payload.trackingToken);
      window.location.assign(`/order/${encodeURIComponent(trackingToken)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <main className="grid min-h-screen place-items-center px-5 text-sm text-stone-600">正在建立安全點餐工作階段...</main>;
  }

  if (!session) {
    return (
      <main className="mx-auto min-h-screen max-w-lg px-5 py-16">
        <ShieldCheck className="h-8 w-8 text-red-700" />
        <h1 className="mt-4 text-2xl font-semibold">目前無法使用此 QR Code</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-stone-600">{message}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl gap-6 px-4 py-5 md:grid-cols-[minmax(0,1fr)_340px] md:px-8">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm font-medium text-teal-800">{session.stall.location}</p><h1 className="mt-1 text-3xl font-semibold">{session.stall.name}</h1></div>
          <label className="text-xs font-medium text-stone-500">語言<select aria-label="商品語言" value={locale} onChange={(event) => setLocale(event.target.value)} className="mt-1 block h-10 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900"><option value="zh-TW">繁體中文</option>{session.supportedLocales.map((supportedLocale) => <option key={supportedLocale} value={supportedLocale}>{localeLabels[supportedLocale] ?? supportedLocale}</option>)}</select></label>
        </div>
        <p className="mt-2 text-sm font-semibold text-stone-700">{session.stall.fulfillmentType === "DINE_IN" ? `內用 · ${session.stall.table?.label}` : "外帶取餐"}</p>
        <div className="mt-3 inline-flex items-center gap-2 text-sm text-stone-600">
          <Clock3 className="h-4 w-4" />
          點餐時間剩餘 {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, "0")}
        </div>

        <div className="mt-6 space-y-7">
          {categories.map((category) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold text-stone-500">{category}</h2>
              <div className="grid gap-3">
                {session.products.filter((product) => product.category === category).map((product) => (
                  <article key={product.id} className="rounded-lg border border-stone-200 bg-white p-4">
                    <div className="flex items-center gap-4">
                      {product.imageUrl ? <div role="img" aria-label={`${localizedProduct(product).name}圖片`} className="h-20 w-20 shrink-0 rounded-md bg-cover bg-center" style={{ backgroundImage: `url("${product.imageUrl.replaceAll('"', "%22")}")` }} /> : null}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold">{localizedProduct(product).name}</h3>
                        <p className="mt-1 text-sm leading-6 text-stone-600">{localizedProduct(product).description}</p>
                        <p className="mt-2 font-semibold">{formatMoney(Math.max(0, product.price + notePriceAdjustment(product.noteGroups, noteSelections[product.id] ?? [])), session.stall.currency)}</p>
                      </div>
                      <div className="grid grid-cols-[40px_28px_40px] items-center gap-2">
                        <button type="button" title="減少數量" aria-label={`減少 ${localizedProduct(product).name}`} disabled={!quantities[product.id]} onClick={() => updateQuantity(product.id, (quantities[product.id] ?? 0) - 1)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-40">
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="text-center font-semibold">{quantities[product.id] ?? 0}</span>
                        <button type="button" title="增加數量" aria-label={`增加 ${localizedProduct(product).name}`} onClick={() => updateQuantity(product.id, (quantities[product.id] ?? 0) + 1)} className="grid h-10 w-10 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-40">
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
                              <legend className="text-sm font-semibold text-stone-700">{localizedGroupName(group)}{group.isRequired ? " *" : ""}<span className="ml-2 text-xs font-normal text-stone-500">{group.selectionMode === "SINGLE" ? "單選" : group.maxSelections ? `最多 ${group.maxSelections} 項` : "複選"}</span></legend>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                                {group.selectionMode === "SINGLE" && !group.isRequired ? <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="radio" name={`note-${product.id}-${group.id}`} checked={selectedCount === 0} onChange={() => selectNoteOption(product.id, group, null)} />不選擇</label> : null}
                                {group.options.map((option) => {
                                  const checked = (noteSelections[product.id] ?? []).includes(option.id);
                                  return <label key={option.id} className="inline-flex min-h-9 items-center gap-2 text-sm"><input type={group.selectionMode === "SINGLE" ? "radio" : "checkbox"} name={`note-${product.id}-${group.id}`} checked={checked} disabled={group.selectionMode === "MULTIPLE" && maximumReached && !checked} onChange={() => selectNoteOption(product.id, group, option.id)} /><span>{localizedOptionName(option)}</span>{option.priceDelta !== 0 ? <span className="text-xs text-stone-500">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, session.stall.currency)}</span> : null}</label>;
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
        <h2 className="text-lg font-semibold">您的訂單</h2>
        <div className="mt-4 space-y-3">
          <input aria-label="顧客稱呼" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" placeholder="稱呼（選填）" maxLength={50} value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          <textarea aria-label="訂單備註" className="min-h-20 w-full rounded-md border border-stone-300 px-3 py-2 text-sm" placeholder={`備註（最多 ${session.limits.maxNoteLength} 字）`} maxLength={session.limits.maxNoteLength} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} />
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-stone-200 pt-4">
          <span className="text-sm text-stone-600">共 {totalQuantity} 份</span>
          <strong>{formatMoney(total, session.stall.currency)}</strong>
        </div>
        <div className="mt-4">
          <TurnstileWidget resetKey={turnstileResetKey} onToken={handleTurnstileToken} />
        </div>
        <button type="button" disabled={isSubmitting || totalQuantity === 0 || !turnstileToken || secondsRemaining <= 0} onClick={submitOrder} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Send className="h-4 w-4" />
          {isSubmitting ? "送出中..." : "送出訂單"}
        </button>
        <p className="mt-3 text-xs leading-5 text-stone-500">送出後須由店員確認，確認前不會開始製作。</p>
        {message ? <p role="alert" className="mt-3 text-sm text-red-700">{message}</p> : null}
      </aside>
    </main>
  );
}
