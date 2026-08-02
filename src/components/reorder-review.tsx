"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, LoaderCircle, RotateCcw } from "lucide-react";
import { formatMoney } from "@/lib/money";
import {
  getOrCreateDeviceId,
  parseEdgeResponse,
  publicEdgeHeaders,
  publicEdgeUrl,
} from "@/lib/public-order-client";
import { qrCartStorageKey, serializeQrCartDraft } from "@/lib/qr-cart";

type ReorderData = {
  qrToken: string;
  orderingMode: "DEFAULT" | "DELIVERY";
  orderPath: string;
  availableItems: Array<{
    productId: string;
    name: string;
    quantity: number;
    noteOptionIds: string[];
    previousUnitPrice: number;
    currentUnitPrice: number;
    priceChanged: boolean;
    needsReview: boolean;
  }>;
  unavailableItems: Array<{ name: string; reason: string }>;
};

export function ReorderReview({ trackingToken }: { trackingToken: string }) {
  const [data, setData] = useState<ReorderData | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(publicEdgeUrl("prepare-reorder"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...publicEdgeHeaders() },
        body: JSON.stringify({ trackingToken, deviceId: getOrCreateDeviceId() }),
        cache: "no-store",
      });
      const payload = await parseEdgeResponse(response);
      if (!response.ok) throw new Error(String(payload.error ?? "目前無法準備再次點餐。"));
      setData(payload as unknown as ReorderData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法準備再次點餐。");
    } finally {
      setLoading(false);
    }
  }, [trackingToken]);

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
          customerName: "",
          customerNote: "",
          customerPhone: "",
          deliveryAddress: "",
          lines: data.availableItems.map((item) => ({
            id: crypto.randomUUID(),
            productId: item.productId,
            quantity: item.quantity,
            note: "",
            noteOptionIds: item.noteOptionIds,
            bundleChoiceIds: [],
          })),
        }),
      );
    } catch {
      setMessage("瀏覽器無法暫存購物車，請改由菜單重新選擇商品。");
      return;
    }
    window.location.assign(data.orderPath);
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-5 py-9">
      <Link href={`/order/${encodeURIComponent(trackingToken)}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800">
        <ArrowLeft className="h-4 w-4" />返回訂單
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">再次點餐</h1>

      {loading ? <div className="mt-10 flex items-center gap-3 text-sm text-stone-600"><LoaderCircle className="h-5 w-5 animate-spin" />正在核對目前菜單</div> : null}
      {message ? <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message}</p> : null}
      {data ? (
        <>
          <section className="mt-7 border-y border-stone-200 py-5">
            <h2 className="font-semibold">可再次選購</h2>
            <div className="mt-3 divide-y divide-stone-100">
              {data.availableItems.map((item, index) => (
                <div key={`${item.productId}-${index}`} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-medium">{item.quantity} × {item.name}</p>
                    {item.needsReview ? <p className="mt-1 text-xs font-medium text-amber-800">商品選項已變更，進入菜單後請重新確認。</p> : null}
                  </div>
                  <div className="text-sm sm:text-right">
                    {item.priceChanged ? <p className="text-stone-500 line-through">原 {formatMoney(item.previousUnitPrice)}</p> : null}
                    <p className={item.priceChanged ? "font-semibold text-red-800" : "font-medium"}>{formatMoney(item.currentUnitPrice)}</p>
                  </div>
                </div>
              ))}
              {data.availableItems.length === 0 ? <p className="py-4 text-sm text-stone-600">原訂單商品目前皆無法供應。</p> : null}
            </div>
          </section>

          {data.unavailableItems.length > 0 ? (
            <section className="mt-6 border-y border-amber-200 py-5">
              <h2 className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="h-5 w-5" />本次不會加入</h2>
              <div className="mt-3 divide-y divide-amber-100">
                {data.unavailableItems.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span>{item.name}</span><span className="font-medium text-amber-900">{item.reason}</span></div>)}
              </div>
            </section>
          ) : null}

          <button type="button" onClick={continueOrdering} disabled={data.availableItems.length === 0} className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-5 font-semibold text-white disabled:opacity-40">
            <RotateCcw className="h-5 w-5" />前往目前菜單確認
          </button>
        </>
      ) : null}
    </main>
  );
}
