"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Clock3, RefreshCw } from "lucide-react";
import { LineNotificationControls } from "@/components/line-notification-controls";
import {
  getOrCreateDeviceId,
  parseEdgeResponse,
  requestPublicOrder,
  respondToFulfillmentTime,
} from "@/lib/public-order-client";

type FulfillmentTimeState =
  | "NOT_REQUESTED"
  | "REQUESTED"
  | "CONFIRMED"
  | "CUSTOMER_ACTION_REQUIRED"
  | "DECLINED"
  | "EXPIRED";

type PublicOrder = {
  orderNo: string;
  orderStatus: "WAITING_CONFIRMATION" | "CONFIRMED" | "PREPARING" | "PACKING" | "READY" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  paymentStatus: "UNPAID" | "PAID" | "REFUNDED";
  totalAmount: number;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  stallName: string;
  pickupVerificationCode: string | null;
  fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
  tableLabel: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  estimatedWaitMinutes: number;
  quotedWaitMinutes: number | null;
  quotedReadyAt: string | null;
  lastTableOrderAt: string | null;
  stallTimezone: string | null;
  requestedFulfillmentAt: string | null;
  committedFulfillmentAt: string | null;
  pendingFulfillmentAt: string | null;
  fulfillmentTimeState: FulfillmentTimeState;
  fulfillmentTimeVersion: number;
  fulfillmentTimeResponseExpiresAt: string | null;
  fulfillmentTimeChangeReason: string | null;
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
  PACKING: "包裝中",
  READY: "可取餐",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "未確認，已逾時",
};

const fulfillmentTimeStateLabels: Record<FulfillmentTimeState, string> = {
  NOT_REQUESTED: "未指定時間",
  REQUESTED: "等待店家確認",
  CONFIRMED: "時間已確認",
  CUSTOMER_ACTION_REQUIRED: "等待您確認新時間",
  DECLINED: "您未接受店家提議",
  EXPIRED: "確認期限已過",
};

type FulfillmentFeedback = {
  kind: "success" | "error";
  message: string;
};

function formatFulfillmentTime(value: string | null, timeZone: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  };
  try {
    return new Intl.DateTimeFormat("zh-TW", options).format(date);
  } catch {
    return new Intl.DateTimeFormat("zh-TW", {
      ...options,
      timeZone: "Asia/Taipei",
    }).format(date);
  }
}

function FulfillmentTimePanel({
  order,
  feedback,
  isResponding,
  onRespond,
}: {
  order: PublicOrder;
  feedback: FulfillmentFeedback | null;
  isResponding: boolean;
  onRespond: (response: "ACCEPT" | "DECLINE") => void;
}) {
  if (
    order.fulfillmentType === "DINE_IN"
    || (
      order.fulfillmentTimeState === "NOT_REQUESTED"
      && !order.requestedFulfillmentAt
      && !order.committedFulfillmentAt
      && !order.pendingFulfillmentAt
    )
  ) return null;

  const timeLabel = order.fulfillmentType === "DELIVERY" ? "送達" : "取餐";
  const requestedAt = formatFulfillmentTime(order.requestedFulfillmentAt, order.stallTimezone);
  const committedAt = formatFulfillmentTime(order.committedFulfillmentAt, order.stallTimezone);
  const pendingAt = formatFulfillmentTime(order.pendingFulfillmentAt, order.stallTimezone);
  const responseExpiresAt = formatFulfillmentTime(
    order.fulfillmentTimeResponseExpiresAt,
    order.stallTimezone,
  );
  const canRespond = order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED"
    && order.fulfillmentTimeVersion >= 1
    && pendingAt !== null;

  return (
    <section aria-labelledby="fulfillment-time-heading" className="mt-5 rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-stone-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="fulfillment-time-heading" className="font-semibold text-stone-900">預計{timeLabel}時間</h2>
          <p className="mt-1 text-xs text-teal-800">{fulfillmentTimeStateLabels[order.fulfillmentTimeState]}</p>
        </div>
        {order.fulfillmentTimeVersion > 0
          ? <span className="shrink-0 text-xs text-stone-500">提議版本 {order.fulfillmentTimeVersion}</span>
          : null}
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-stone-500">您原先選擇</dt>
        <dd className="font-medium text-stone-900">{requestedAt ?? "未指定"}</dd>
        <dt className="text-stone-500">目前已確認</dt>
        <dd className="font-medium text-stone-900">{committedAt ?? "尚未確認"}</dd>
        {order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED"
          ? (
            <>
              <dt className="text-stone-500">店家提議</dt>
              <dd className="font-semibold text-teal-900">{pendingAt ?? "時間資料異常"}</dd>
            </>
          )
          : null}
      </dl>

      {order.fulfillmentTimeChangeReason
        ? <p className="mt-3 rounded bg-white/70 px-3 py-2">店家說明：{order.fulfillmentTimeChangeReason}</p>
        : null}
      {canRespond
        ? (
          <div className="mt-4">
            {responseExpiresAt
              ? <p className="text-xs text-stone-500">請於 {responseExpiresAt} 前回覆。</p>
              : null}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={isResponding}
                onClick={() => onRespond("ACCEPT")}
                className="rounded-md bg-teal-700 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResponding ? "送出中…" : `接受新${timeLabel}時間`}
              </button>
              <button
                type="button"
                disabled={isResponding}
                onClick={() => onRespond("DECLINE")}
                className="rounded-md border border-stone-300 bg-white px-4 py-3 font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                無法接受，請店家聯絡
              </button>
            </div>
          </div>
        )
        : null}
      {feedback
        ? (
          <p
            role={feedback.kind === "error" ? "alert" : "status"}
            className={`mt-3 rounded-md px-3 py-2 ${feedback.kind === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}
          >
            {feedback.message}
          </p>
        )
        : null}
    </section>
  );
}

export function PublicOrderTracker({ trackingToken }: { trackingToken: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isResponding, setIsResponding] = useState(false);
  const [fulfillmentFeedback, setFulfillmentFeedback] = useState<FulfillmentFeedback | null>(null);

  const loadOrder = useCallback(async () => {
    setMessage("");
    try {
      const response = await requestPublicOrder("get-public-order", {
        trackingToken,
        deviceId: getOrCreateDeviceId(),
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

  const respondToProposal = useCallback(async (responseValue: "ACCEPT" | "DECLINE") => {
    if (!order || order.fulfillmentTimeState !== "CUSTOMER_ACTION_REQUIRED") return;
    setIsResponding(true);
    setFulfillmentFeedback(null);
    try {
      const response = await respondToFulfillmentTime({
        trackingToken,
        deviceId: getOrCreateDeviceId(),
        version: order.fulfillmentTimeVersion,
        response: responseValue,
      });
      const payload = await parseEdgeResponse(response);
      if (!response.ok) {
        throw new Error(String(payload.error ?? "目前無法確認時間。"));
      }
      setFulfillmentFeedback({
        kind: "success",
        message: responseValue === "ACCEPT"
          ? "已接受店家提議的新時間。"
          : "已通知店家此時間無法配合，請等候店家聯絡。",
      });
      await loadOrder();
    } catch (error) {
      setFulfillmentFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "目前無法確認時間。",
      });
    } finally {
      setIsResponding(false);
    }
  }, [loadOrder, order, trackingToken]);

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
              <div className="text-xs text-stone-500">{order.fulfillmentType === "DINE_IN" ? "內用桌位" : order.fulfillmentType === "DELIVERY" ? "外送地址" : "取餐驗證碼"}</div>
              <div data-testid={order.fulfillmentType === "TAKEOUT" ? "pickup-code" : undefined} className={`mt-1 font-semibold ${order.fulfillmentType === "TAKEOUT" ? "font-mono text-3xl tracking-normal" : "break-words text-base"}`}>{order.fulfillmentType === "DINE_IN" ? order.tableLabel : order.fulfillmentType === "DELIVERY" ? order.deliveryAddress : order.pickupVerificationCode}</div>
              {order.fulfillmentType === "DELIVERY" && order.customerPhone ? <div className="mt-1 text-xs text-stone-500">{order.customerPhone}</div> : null}
            </div>
            <div>
              <div className="text-xs text-stone-500">付款狀態</div>
              <div className="mt-2 font-semibold">{order.paymentStatus === "PAID" ? "已付款" : "待付款"}</div>
            </div>
          </div>
          <div className="mt-5 rounded-md bg-stone-50 px-4 py-3 text-sm text-stone-700">
            {order.orderStatus === "READY" || order.orderStatus === "COMPLETED"
              ? order.fulfillmentType === "DELIVERY" ? "餐點已完成，請留意店家後續配送與聯絡。" : "餐點已完成，請依畫面狀態取餐或等候出餐。"
              : (order.quotedWaitMinutes ?? order.estimatedWaitMinutes) > 0
                ? `訂單成立時預估等候約 ${order.quotedWaitMinutes ?? order.estimatedWaitMinutes} 分鐘。`
                : "目前可立即處理。"}
            {order.quotedReadyAt && !["READY", "COMPLETED", "CANCELLED", "EXPIRED"].includes(order.orderStatus)
              ? <div className="mt-1 text-xs text-stone-500">原預估完成時間：{new Date(order.quotedReadyAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</div>
              : null}
            {order.fulfillmentType === "DINE_IN" && order.lastTableOrderAt ? <div className="mt-1 text-xs text-stone-500">同桌最近追加點餐：{new Date(order.lastTableOrderAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</div> : null}
          </div>
          <FulfillmentTimePanel
            order={order}
            feedback={fulfillmentFeedback}
            isResponding={isResponding}
            onRespond={(response) => void respondToProposal(response)}
          />
          <div className="mt-6 divide-y divide-stone-100 border-y border-stone-200">{order.items.map((item) => <div key={item.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto]"><div><span>{item.quantity} × {item.name}</span>{item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{item.noteOptions.map((noteOption) => `${noteOption.groupName}：${noteOption.optionName}`).join("、")}</p> : null}{item.note ? <p className="mt-1 text-xs text-stone-500">備註：{item.note}</p> : null}</div><span className="font-medium text-stone-600">{itemStatusLabels[item.status]}</span></div>)}</div>
          {order.fulfillmentType === "TAKEOUT" ? <p className="mt-5 text-sm leading-6 text-stone-600">請在取餐時向攤位人員出示驗證碼。訂單確認前不會開始製作。</p> : null}
          <LineNotificationControls trackingToken={trackingToken} />
        </section>
      ) : null}
    </main>
  );
}
