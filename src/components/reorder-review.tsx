"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { useAppLocale } from "@/components/locale-provider";
import { publicMessages } from "@/lib/messages/public";
import { formatMoney } from "@/lib/money";
import {
  getOrCreateDeviceId,
  parseEdgeResponse,
  requestPrepareReorder,
} from "@/lib/public-order-client";
import { qrCartStorageKey, serializeQrCartDraft } from "@/lib/qr-cart";
import { localizedPublicOrderError } from "@/lib/qr-order-i18n";
import { createWebUuid } from "@/lib/web-uuid";

type ReorderData = {
  qrToken: string;
  orderingMode: "PREORDER" | "DELIVERY";
  orderPath: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  customerNote: string;
  scheduledPickupAt: string;
  availableItems: Array<{
    productId: string;
    name: string;
    quantity: number;
    note: string;
    noteOptionIds: string[];
    bundleChoiceIds: string[];
    previousUnitPrice: number;
    currentUnitPrice: number;
    priceChanged: boolean;
    needsReview: boolean;
  }>;
  unavailableItems: Array<{ name: string; reason: string }>;
};

export function ReorderReview({ trackingToken }: { trackingToken: string }) {
  const { locale } = useAppLocale();
  const [data, setData] = useState<ReorderData | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await requestPrepareReorder({
        trackingToken,
        deviceId: getOrCreateDeviceId(),
      });
      const payload = await parseEdgeResponse(response);
      if (!response.ok) throw new Error(
        typeof payload.code === "string"
          ? localizedPublicOrderError(locale, payload.code)
          : publicMessages.get(locale, "reorderPrepareError"),
      );
      setData(payload as unknown as ReorderData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : publicMessages.get(locale, "reorderPrepareError"));
    } finally {
      setLoading(false);
    }
  }, [locale, trackingToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function continueOrdering() {
    if (!data || data.availableItems.length === 0) return;
    try {
      window.localStorage.setItem(
        qrCartStorageKey(data.qrToken, data.orderingMode),
        serializeQrCartDraft({
          orderingMode: data.orderingMode,
          scheduledPickupAt: data.scheduledPickupAt,
          customerName: data.customerName,
          customerNote: data.customerNote,
          customerPhone: data.customerPhone,
          deliveryAddress: data.deliveryAddress,
          lines: data.availableItems.map((item) => ({
            id: createWebUuid(),
            productId: item.productId,
            quantity: item.quantity,
            note: item.note,
            noteOptionIds: item.noteOptionIds,
            bundleChoiceIds: item.bundleChoiceIds,
          })),
        }),
      );
    } catch {
      setMessage(publicMessages.get(locale, "reorderStorageError"));
      return;
    }
    const separator = data.orderPath.includes("?") ? "&" : "?";
    window.location.assign(
      `${data.orderPath}${separator}editOrder=${encodeURIComponent(trackingToken)}`,
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-5 py-9">
      <ContextualBackButton fallbackHref={`/order/${encodeURIComponent(trackingToken)}`}>{publicMessages.get(locale, "reorderBack")}</ContextualBackButton>
      <h1 className="mt-4 text-3xl font-semibold">{publicMessages.get(locale, "reorderTitle")}</h1>

      {loading ? <div className="mt-10 flex items-center gap-3 text-sm text-stone-600"><LoaderCircle className="h-5 w-5 animate-spin" />{publicMessages.get(locale, "reorderChecking")}</div> : null}
      {message ? <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message}</p> : null}
      {data ? (
        <>
          <section className="mt-7 border-y border-stone-200 py-5">
            <h2 className="font-semibold">{publicMessages.get(locale, "reorderAvailable")}</h2>
            <div className="mt-3 divide-y divide-stone-100">
              {data.availableItems.map((item, index) => (
                <div key={`${item.productId}-${index}`} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-medium">{item.quantity} × {item.name}</p>
                    {item.needsReview ? <p className="mt-1 text-xs font-medium text-amber-800">{publicMessages.get(locale, "reorderOptionsChanged")}</p> : null}
                  </div>
                  <div className="text-sm sm:text-right">
                    {item.priceChanged ? <p className="text-stone-500 line-through">{publicMessages.get(locale, "reorderPreviousPrice", { price: formatMoney(item.previousUnitPrice, "TWD", locale) })}</p> : null}
                    <p className={item.priceChanged ? "font-semibold text-red-800" : "font-medium"}>{formatMoney(item.currentUnitPrice, "TWD", locale)}</p>
                  </div>
                </div>
              ))}
              {data.availableItems.length === 0 ? <p className="py-4 text-sm text-stone-600">{publicMessages.get(locale, "reorderNoneAvailable")}</p> : null}
            </div>
          </section>

          {data.unavailableItems.length > 0 ? (
            <section className="mt-6 border-y border-amber-200 py-5">
              <h2 className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="h-5 w-5" />{publicMessages.get(locale, "reorderExcluded")}</h2>
              <div className="mt-3 divide-y divide-amber-100">
                {data.unavailableItems.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span>{item.name}</span><span className="font-medium text-amber-900">{item.reason}</span></div>)}
              </div>
            </section>
          ) : null}

          <button type="button" onClick={continueOrdering} disabled={data.availableItems.length === 0} className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-5 font-semibold text-white disabled:opacity-40">
            <RotateCcw className="h-5 w-5" />{publicMessages.get(locale, "reorderContinue")}
          </button>
        </>
      ) : null}
    </main>
  );
}
