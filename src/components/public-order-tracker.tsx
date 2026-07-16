"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Clock3, RefreshCw } from "lucide-react";
import { getOrCreateDeviceId, parseEdgeResponse, publicEdgeUrl } from "@/lib/public-order-client";

type PublicOrder = {
  orderNo: string;
  orderStatus: "WAITING_CONFIRMATION" | "CONFIRMED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  paymentStatus: "UNPAID" | "PAID" | "REFUNDED";
  totalAmount: number;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  stallName: string;
  pickupVerificationCode: string | null;
  fulfillmentType: "TAKEOUT" | "DINE_IN";
  tableLabel: string | null;
  estimatedWaitMinutes: number;
  lastTableOrderAt: string | null;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    note: string | null;
    noteOptions: Array<{ groupName: string; optionName: string; priceDelta: number }>;
    status: "PENDING" | "PREPARING" | "READY" | "SERVED";
  }>;
};

const itemStatusLabels: Record<PublicOrder["items"][number]["status"], string> = {
  PENDING: "待製作",
  PREPARING: "製作中",
  READY: "待出餐",
  SERVED: "已出餐",
};

const statusLabels: Record<PublicOrder["orderStatus"], string> = {
  WAITING_CONFIRMATION: "等待攤位確認",
  CONFIRMED: "攤位已確認",
  PREPARING: "製作中",
  READY: "可取餐",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "未確認，已逾時",
};

export function PublicOrderTracker({ trackingToken }: { trackingToken: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const loadOrder = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(publicEdgeUrl("get-public-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingToken, deviceId: getOrCreateDeviceId() }),
        cache: "no-store",
      });
      const payload = await parseEdgeResponse(response);
      if (!response.ok) throw new Error(String(payload.error ?? "找不到此訂單。"));
      setOrder(payload.order as unknown as PublicOrder);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法查詢訂單。");
    } finally {
      setIsLoading(false);
    }
  }, [trackingToken]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadOrder(), 0);
    const refreshTimer = window.setInterval(() => void loadOrder(), 10_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
    };
  }, [loadOrder]);

  return (
    <main className="mx-auto min-h-screen max-w-xl px-5 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-800">即時訂單狀態</p>
          <h1 className="mt-1 text-3xl font-semibold">{order?.stallName ?? "StallOrder"}</h1>
        </div>
        <button type="button" title="重新整理" aria-label="重新整理訂單" onClick={() => void loadOrder()} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 bg-white">
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {message ? <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message}</p> : null}
      {order ? (
        <section className="mt-8 border-y border-stone-200 py-6">
          <div className="flex items-center gap-3">
            {order.orderStatus === "READY" || order.orderStatus === "COMPLETED" ? <BadgeCheck className="h-6 w-6 text-teal-700" /> : <Clock3 className="h-6 w-6 text-amber-700" />}
            <div>
              <div className="text-sm text-stone-500">訂單 {order.orderNo}</div>
              <div className="text-xl font-semibold">{statusLabels[order.orderStatus]}</div>
            </div>
          </div>
          <div className="mt-7 grid grid-cols-2 gap-5">
            <div>
              <div className="text-xs text-stone-500">{order.fulfillmentType === "DINE_IN" ? "內用桌位" : "取餐驗證碼"}</div>
              <div data-testid={order.fulfillmentType === "TAKEOUT" ? "pickup-code" : undefined} className={`mt-1 font-semibold ${order.fulfillmentType === "TAKEOUT" ? "font-mono text-3xl tracking-normal" : "text-xl"}`}>{order.fulfillmentType === "DINE_IN" ? order.tableLabel : order.pickupVerificationCode}</div>
            </div>
            <div>
              <div className="text-xs text-stone-500">付款狀態</div>
              <div className="mt-2 font-semibold">{order.paymentStatus === "PAID" ? "已付款" : "待付款"}</div>
            </div>
          </div>
          <div className="mt-5 rounded-md bg-stone-50 px-4 py-3 text-sm text-stone-700">
            {order.orderStatus === "READY" || order.orderStatus === "COMPLETED"
              ? "餐點已完成，請依畫面狀態取餐或等候出餐。"
              : order.estimatedWaitMinutes > 0 ? `目前預估等候約 ${order.estimatedWaitMinutes} 分鐘。` : "目前可立即處理。"}
            {order.fulfillmentType === "DINE_IN" && order.lastTableOrderAt ? <div className="mt-1 text-xs text-stone-500">同桌最近追加點餐：{new Date(order.lastTableOrderAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</div> : null}
          </div>
          <div className="mt-6 divide-y divide-stone-100 border-y border-stone-200">{order.items.map((item) => <div key={item.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto]"><div><span>{item.quantity} × {item.name}</span>{item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{item.noteOptions.map((noteOption) => `${noteOption.groupName}：${noteOption.optionName}`).join("、")}</p> : null}{item.note ? <p className="mt-1 text-xs text-stone-500">備註：{item.note}</p> : null}</div><span className="font-medium text-stone-600">{itemStatusLabels[item.status]}</span></div>)}</div>
          {order.fulfillmentType === "TAKEOUT" ? <p className="mt-5 text-sm leading-6 text-stone-600">請在取餐時向攤位人員出示驗證碼。訂單確認前不會開始製作。</p> : null}
        </section>
      ) : null}
    </main>
  );
}
