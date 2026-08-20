"use client";

import { useCallback, useState } from "react";
import { BadgeCheck, ChevronDown, CircleHelp, CircleX, Clock3, RefreshCw } from "lucide-react";
import { LineNotificationControls } from "@/components/line-notification-controls";
import {
  getOrCreateDeviceId,
  parseEdgeResponse,
  requestPublicOrder,
  respondToFulfillmentTime,
} from "@/lib/public-order-client";
import { useLiveResource } from "@/lib/use-live-resource";

type FulfillmentTimeState =
  | "NOT_REQUESTED"
  | "REQUESTED"
  | "CONFIRMED"
  | "CUSTOMER_ACTION_REQUIRED"
  | "DECLINED"
  | "EXPIRED";

type PublicOrderStatus = "WAITING_CONFIRMATION" | "CONFIRMED" | "PREPARING" | "PACKING" | "READY" | "COMPLETED" | "CANCELLED" | "EXPIRED";
type PublicFulfillmentType = "TAKEOUT" | "DINE_IN" | "DELIVERY";

type PublicOrder = {
  orderNo: string;
  orderStatus: PublicOrderStatus;
  paymentStatus: "UNPAID" | "PAID" | "REFUNDED";
  totalAmount: number;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  stallName: string;
  pickupVerificationCode: string | null;
  fulfillmentType: PublicFulfillmentType;
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

type OrderProgress = {
  steps: string[];
  currentStep: number | null;
  currentMessage: string;
  nextAction: string;
};

export function getPublicOrderStatusLabel(
  orderStatus: PublicOrderStatus,
  fulfillmentType: PublicFulfillmentType,
) {
  if (orderStatus !== "READY") return statusLabels[orderStatus];
  if (fulfillmentType === "DELIVERY") return "待配送";
  if (fulfillmentType === "DINE_IN") return "待出餐";
  return statusLabels.READY;
}

export function getPublicOrderProgress(
  orderStatus: PublicOrderStatus,
  fulfillmentType: PublicFulfillmentType,
): OrderProgress {
  const handoffStep = fulfillmentType === "TAKEOUT"
    ? "可取餐"
    : fulfillmentType === "DINE_IN"
      ? "待出餐"
      : "待配送";
  const steps = ["訂單送出", "攤位確認", "餐點製作", handoffStep, "已完成"];
  const handoffNextAction = fulfillmentType === "TAKEOUT"
    ? "餐點完成後，畫面會顯示可取餐。"
    : fulfillmentType === "DINE_IN"
      ? "餐點完成後，請留意現場叫號或服務人員出餐。"
      : "餐點完成後，請留意店家後續配送與聯絡。";

  switch (orderStatus) {
    case "WAITING_CONFIRMATION":
      return {
        steps,
        currentStep: 0,
        currentMessage: "訂單已送出，正在等待攤位確認。",
        nextAction: "攤位確認後才會開始製作。",
      };
    case "CONFIRMED":
      return {
        steps,
        currentStep: 1,
        currentMessage: "攤位已接受訂單。",
        nextAction: "接下來會開始製作餐點。",
      };
    case "PREPARING":
      return {
        steps,
        currentStep: 2,
        currentMessage: "餐點正在製作中。",
        nextAction: handoffNextAction,
      };
    case "PACKING":
      return {
        steps,
        currentStep: 2,
        currentMessage: "餐點正在包裝。",
        nextAction: handoffNextAction,
      };
    case "READY":
      return {
        steps,
        currentStep: 3,
        currentMessage: fulfillmentType === "TAKEOUT"
          ? "餐點已完成，可以取餐。"
          : fulfillmentType === "DINE_IN"
            ? "餐點已完成，等待出餐。"
            : "餐點已完成，等待配送。",
        nextAction: fulfillmentType === "TAKEOUT"
          ? "請攜帶取餐驗證碼到攤位取餐。"
          : fulfillmentType === "DINE_IN"
            ? "請留意現場叫號或服務人員出餐。"
            : "請留意店家後續配送與聯絡。",
      };
    case "COMPLETED":
      return {
        steps,
        currentStep: 4,
        currentMessage: "訂單已完成。",
        nextAction: "感謝您的光臨。",
      };
    case "CANCELLED":
      return {
        steps,
        currentStep: null,
        currentMessage: "訂單已取消，流程已停止。",
        nextAction: "如有疑問，請直接聯絡現場攤位。",
      };
    case "EXPIRED":
      return {
        steps,
        currentStep: null,
        currentMessage: "訂單因逾時未確認，流程已結束。",
        nextAction: "若仍需餐點，請重新掃碼下單或聯絡現場攤位。",
      };
  }
}

export function OrderProgressPanel({
  orderStatus,
  fulfillmentType,
}: {
  orderStatus: PublicOrderStatus;
  fulfillmentType: PublicFulfillmentType;
}) {
  const progress = getPublicOrderProgress(orderStatus, fulfillmentType);

  return (
    <section aria-labelledby="order-progress-heading" className="mt-4 rounded-md border border-stone-200 bg-white p-3 sm:mt-5 sm:p-4">
      <h2 id="order-progress-heading" className="text-sm font-semibold text-stone-900">訂單進度</h2>
      {progress.currentStep === null
        ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 sm:py-3">
            <p className="font-semibold">目前：{progress.currentMessage}</p>
            <p className="mt-1">下一步：{progress.nextAction}</p>
          </div>
        )
        : (
          <>
            <ol aria-label="訂單進度" className="mt-3 grid grid-cols-5 gap-1 sm:mt-4">
              {progress.steps.map((step, index) => {
                const isComplete = index < progress.currentStep!;
                const isCurrent = index === progress.currentStep;
                return (
                  <li
                    key={step}
                    aria-current={isCurrent ? "step" : undefined}
                    className={`flex min-w-0 flex-col items-center gap-1.5 text-center text-[0.6875rem] leading-tight sm:gap-2 ${isCurrent ? "font-semibold text-teal-800" : isComplete ? "text-teal-700" : "text-stone-400"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid h-7 w-7 place-items-center rounded-full border ${isCurrent ? "border-teal-700 bg-teal-700 text-white" : isComplete ? "border-teal-600 bg-teal-50" : "border-stone-300 bg-white"}`}
                    >
                      {isComplete ? "✓" : index + 1}
                    </span>
                    <span>
                      <span className="sr-only">
                        {isComplete ? "已完成：" : isCurrent ? "目前：" : "尚未進行："}
                      </span>
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 rounded-md bg-stone-50 px-3 py-2.5 text-sm text-stone-700 sm:mt-4 sm:py-3">
              <p><span className="font-semibold text-stone-900">目前：</span>{progress.currentMessage}</p>
              <p className="mt-1"><span className="font-semibold text-stone-900">下一步：</span>{progress.nextAction}</p>
            </div>
          </>
        )}
    </section>
  );
}

export function getOrderHelpGuidance(fulfillmentType: PublicFulfillmentType) {
  switch (fulfillmentType) {
    case "TAKEOUT":
      return "若重新整理後仍未更新，請到取餐攤位出示訂單編號與取餐驗證碼，請現場人員協助確認。";
    case "DINE_IN":
      return "若重新整理後仍未更新，請向現場人員出示訂單編號與桌位，請人員協助確認出餐進度。";
    case "DELIVERY":
      return "若重新整理後仍未更新，請向原下單攤位的現場人員出示訂單編號，請店家協助確認配送進度。";
  }
}

export function OrderHelpPanel({
  fulfillmentType,
  isOnline,
  isRefreshing,
  onRefresh,
}: {
  fulfillmentType: PublicFulfillmentType;
  isOnline: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <details className="group mt-6 rounded-md border border-stone-200 bg-stone-50">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-stone-900 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <CircleHelp aria-hidden="true" className="h-5 w-5 text-teal-700" />
          需要協助
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-stone-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-stone-200 px-4 py-4 text-sm text-stone-700">
        <p className="leading-6">{getOrderHelpGuidance(fulfillmentType)}</p>
        {!isOnline ? (
          <p role="status" aria-live="polite" className="mt-3 text-amber-800">
            目前裝置離線，恢復連線後即可重新整理。
          </p>
        ) : null}
        <button
          type="button"
          aria-label="從協助區重新整理訂單狀態"
          disabled={!isOnline || isRefreshing}
          onClick={onRefresh}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 bg-white px-4 font-semibold text-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "更新中…" : "重新整理訂單狀態"}
        </button>
      </div>
    </details>
  );
}

export function formatOrderRefreshTime(updatedAt: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(updatedAt);
}

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
  const [isOnline, setIsOnline] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [fulfillmentFeedback, setFulfillmentFeedback] = useState<FulfillmentFeedback | null>(null);

  const loadOrder = useCallback(async ({ signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted();
    const response = await requestPublicOrder("get-public-order", {
      trackingToken,
      deviceId: getOrCreateDeviceId(),
    }, { signal });
    const payload = await parseEdgeResponse(response);
    signal.throwIfAborted();
    if (!response.ok) {
      throw new Error(response.status === 404
        ? "找不到此訂單，請確認連結是否正確。"
        : "目前無法更新訂單狀態，請稍後重試。");
    }
    return { value: payload.order as unknown as PublicOrder };
  }, [trackingToken]);

  const { refresh: refreshOrder } = useLiveResource<PublicOrder>({
    resourceKey: trackingToken,
    load: loadOrder,
    onData: (nextOrder) => {
      setOrder(nextOrder);
      setLastUpdatedAt(new Date());
      setMessage("");
    },
    onError: (error) => {
      setMessage(error instanceof Error && error.message.startsWith("找不到此訂單")
        ? error.message
        : "目前無法更新訂單狀態，請稍後重試。");
    },
    onLoadingChange: setIsLoading,
    onOnlineChange: (online) => {
      setIsOnline(online);
      if (!online) {
        setMessage("目前裝置離線，恢復連線後會自動更新。");
        setIsLoading(false);
      }
    },
  });

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
      await refreshOrder();
    } catch (error) {
      setFulfillmentFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "目前無法確認時間。",
      });
    } finally {
      setIsResponding(false);
    }
  }, [order, refreshOrder, trackingToken]);

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-6 sm:px-5 sm:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-800">即時訂單狀態</p>
          <h1 className="mt-1 text-3xl font-semibold">{order?.stallName ?? "StallOrder"}</h1>
          <p className="mt-2 text-xs text-stone-500">
            {!isOnline
              ? "目前離線，恢復連線後會自動更新。"
              : isLoading
                ? order ? "更新中…" : "正在載入訂單…"
                : lastUpdatedAt
                  ? `最後更新：${formatOrderRefreshTime(lastUpdatedAt)}`
                  : "等待更新…"}
          </p>
        </div>
        <button type="button" title="重新整理" aria-label="重新整理訂單" disabled={isLoading || !isOnline} onClick={() => void refreshOrder()} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white disabled:cursor-not-allowed disabled:opacity-60">
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {message ? <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message}</p> : null}
      {order ? (
        <section className="mt-5 border-y border-stone-200 py-4 sm:mt-8 sm:py-6">
          <div className="flex items-center gap-3">
            {order.orderStatus === "CANCELLED" || order.orderStatus === "EXPIRED"
              ? <CircleX aria-hidden="true" className="h-6 w-6 text-red-700" />
              : order.orderStatus === "READY" || order.orderStatus === "COMPLETED"
                ? <BadgeCheck aria-hidden="true" className="h-6 w-6 text-teal-700" />
                : <Clock3 aria-hidden="true" className="h-6 w-6 text-amber-700" />}
            <div>
              <div className="text-sm text-stone-500">訂單 {order.orderNo}</div>
              <div className="text-xl font-semibold">{getPublicOrderStatusLabel(order.orderStatus, order.fulfillmentType)}</div>
            </div>
          </div>
          <OrderProgressPanel
            orderStatus={order.orderStatus}
            fulfillmentType={order.fulfillmentType}
          />
          <div className="mt-5 grid grid-cols-2 gap-4 sm:mt-7 sm:gap-5">
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
          <OrderHelpPanel
            fulfillmentType={order.fulfillmentType}
            isOnline={isOnline}
            isRefreshing={isLoading}
            onRefresh={() => void refreshOrder()}
          />
          <LineNotificationControls trackingToken={trackingToken} />
        </section>
      ) : null}
    </main>
  );
}
