"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, ChevronDown, CircleHelp, CircleX, Clock3, FilePenLine, LoaderCircle, RefreshCw, Store, Trash2, X } from "lucide-react";
import { LineNotificationControls } from "@/components/line-notification-controls";
import { useAppLocale } from "@/components/locale-provider";
import type { AppLocale } from "@/lib/app-locale";
import { playAlertSound, primeAlertSound } from "@/lib/browser-alert-sound";
import { publicOrderMessages } from "@/lib/messages/public-order";
import { formatMoney } from "@/lib/money";
import {
  getOrCreateDeviceId,
  parseEdgeResponse,
  createPublicOrderOperationId,
  publicOrderCircuitHeaders,
  requestPublicOrder,
  respondToFulfillmentTime,
} from "@/lib/public-order-client";
import { useLiveResource } from "@/lib/use-live-resource";
import { localizedPublicOrderError } from "@/lib/qr-order-i18n";

type FulfillmentTimeState =
  | "NOT_REQUESTED"
  | "REQUESTED"
  | "CONFIRMED"
  | "CUSTOMER_ACTION_REQUIRED"
  | "DECLINED"
  | "EXPIRED";

type PublicOrderStatus = "WAITING_CONFIRMATION" | "CONFIRMED" | "PREPARING" | "PACKING" | "READY" | "COMPLETED" | "CANCELLED" | "EXPIRED";
type PublicFulfillmentType = "TAKEOUT" | "DINE_IN" | "DELIVERY";

export function getPublicOrderCustomerActions(
  orderStatus: PublicOrderStatus,
  fulfillmentType: PublicFulfillmentType,
  paymentStatus: PublicOrder["paymentStatus"],
) {
  const publicFulfillment = fulfillmentType === "TAKEOUT" || fulfillmentType === "DELIVERY";
  const unpaid = paymentStatus === "UNPAID";
  return {
    canModify: publicFulfillment && unpaid && (orderStatus === "WAITING_CONFIRMATION" || orderStatus === "CONFIRMED"),
    canCancel: publicFulfillment && unpaid && orderStatus === "WAITING_CONFIRMATION",
  };
}

type PublicOrder = {
  orderNo: string;
  orderStatus: PublicOrderStatus;
  paymentStatus: "UNPAID" | "PAID" | "REFUNDED";
  totalAmount: number;
  currency: string;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  stallName: string;
  publicMenuIdentifier: string | null;
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
  merchantAmendment: OrderAmendmentNotice | null;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    note: string | null;
    noteOptions: Array<{ groupName: string; optionName: string; priceDelta: number }>;
    status: "PENDING" | "PREPARING" | "READY" | "SERVED";
  }>;
};

export type OrderAmendmentNotice = {
  id: string;
  reason: "SOLD_OUT_REMOVE" | "SOLD_OUT_REPLACE" | "QUANTITY_ADJUSTMENT" | "OTHER";
  message: string;
  previousTotal: number | null;
  total: number | null;
  createdAt: string;
};

const itemStatusMessageKeys = {
  PENDING: "itemPending",
  PREPARING: "itemPreparing",
  READY: "itemReady",
  SERVED: "itemServed",
} as const;

const statusMessageKeys = {
  WAITING_CONFIRMATION: "statusWaiting",
  CONFIRMED: "statusConfirmed",
  PREPARING: "statusPreparing",
  PACKING: "statusPacking",
  COMPLETED: "statusCompleted",
  CANCELLED: "statusCancelled",
  EXPIRED: "statusExpired",
} as const;

type OrderProgress = {
  steps: string[];
  currentStep: number | null;
  currentMessage: string;
  nextAction: string;
};

export function getPublicOrderStatusLabel(
  orderStatus: PublicOrderStatus,
  fulfillmentType: PublicFulfillmentType,
  locale: AppLocale = "zh-TW",
) {
  if (orderStatus !== "READY") return publicOrderMessages.get(locale, statusMessageKeys[orderStatus]);
  return publicOrderMessages.get(
    locale,
    fulfillmentType === "DELIVERY"
      ? "statusReadyDelivery"
      : fulfillmentType === "DINE_IN"
        ? "statusReadyDineIn"
        : "statusReadyTakeout",
  );
}

export function getPublicOrderProgress(
  orderStatus: PublicOrderStatus,
  fulfillmentType: PublicFulfillmentType,
  locale: AppLocale = "zh-TW",
): OrderProgress {
  const handoffStep = getPublicOrderStatusLabel("READY", fulfillmentType, locale);
  const steps = [
    publicOrderMessages.get(locale, "stepSent"),
    publicOrderMessages.get(locale, "stepConfirmed"),
    publicOrderMessages.get(locale, "stepPreparing"),
    handoffStep,
    publicOrderMessages.get(locale, "stepCompleted"),
  ];
  const handoffNextAction = publicOrderMessages.get(
    locale,
    fulfillmentType === "TAKEOUT"
      ? "nextTakeout"
      : fulfillmentType === "DINE_IN"
        ? "nextDineIn"
        : "nextDelivery",
  );

  switch (orderStatus) {
    case "WAITING_CONFIRMATION":
      return {
        steps,
        currentStep: 0,
        currentMessage: publicOrderMessages.get(locale, "currentWaiting"),
        nextAction: publicOrderMessages.get(locale, "nextWaiting"),
      };
    case "CONFIRMED":
      return {
        steps,
        currentStep: 1,
        currentMessage: publicOrderMessages.get(locale, "currentOrderConfirmed"),
        nextAction: publicOrderMessages.get(locale, "nextConfirmed"),
      };
    case "PREPARING":
      return {
        steps,
        currentStep: 2,
        currentMessage: publicOrderMessages.get(locale, "currentPreparing"),
        nextAction: handoffNextAction,
      };
    case "PACKING":
      return {
        steps,
        currentStep: 2,
        currentMessage: publicOrderMessages.get(locale, "currentPacking"),
        nextAction: handoffNextAction,
      };
    case "READY":
      return {
        steps,
        currentStep: 3,
        currentMessage: publicOrderMessages.get(
          locale,
          fulfillmentType === "TAKEOUT"
            ? "currentReadyTakeout"
            : fulfillmentType === "DINE_IN"
              ? "currentReadyDineIn"
              : "currentReadyDelivery",
        ),
        nextAction: handoffNextAction,
      };
    case "COMPLETED":
      return {
        steps,
        currentStep: 4,
        currentMessage: publicOrderMessages.get(locale, "currentCompleted"),
        nextAction: publicOrderMessages.get(locale, "nextCompleted"),
      };
    case "CANCELLED":
      return {
        steps,
        currentStep: null,
        currentMessage: publicOrderMessages.get(locale, "currentCancelled"),
        nextAction: publicOrderMessages.get(locale, "nextCancelled"),
      };
    case "EXPIRED":
      return {
        steps,
        currentStep: null,
        currentMessage: publicOrderMessages.get(locale, "currentExpired"),
        nextAction: publicOrderMessages.get(locale, "nextExpired"),
      };
  }
}

export function OrderProgressPanel({
  orderStatus,
  fulfillmentType,
  locale = "zh-TW",
}: {
  orderStatus: PublicOrderStatus;
  fulfillmentType: PublicFulfillmentType;
  locale?: AppLocale;
}) {
  const progress = getPublicOrderProgress(orderStatus, fulfillmentType, locale);

  return (
    <section aria-labelledby="order-progress-heading" className="mt-4 rounded-md border border-stone-200 bg-white p-3 sm:mt-5 sm:p-4">
      <h2 id="order-progress-heading" className="text-sm font-semibold text-stone-900">{publicOrderMessages.get(locale, "progressTitle")}</h2>
      {progress.currentStep === null
        ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 sm:py-3">
            <p className="font-semibold">{publicOrderMessages.get(locale, "currentPrefix")}{progress.currentMessage}</p>
            <p className="mt-1">{publicOrderMessages.get(locale, "nextPrefix")}{progress.nextAction}</p>
          </div>
        )
        : (
          <>
            <ol aria-label={publicOrderMessages.get(locale, "progressTitle")} className="mt-3 grid grid-cols-5 gap-1 sm:mt-4">
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
                        {publicOrderMessages.get(locale, isComplete ? "stepDone" : isCurrent ? "stepCurrent" : "stepPending")}
                      </span>
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 rounded-md bg-stone-50 px-3 py-2.5 text-sm text-stone-700 sm:mt-4 sm:py-3">
              <p><span className="font-semibold text-stone-900">{publicOrderMessages.get(locale, "currentPrefix")}</span>{progress.currentMessage}</p>
              <p className="mt-1"><span className="font-semibold text-stone-900">{publicOrderMessages.get(locale, "nextPrefix")}</span>{progress.nextAction}</p>
            </div>
          </>
        )}
    </section>
  );
}

export function getOrderHelpGuidance(
  fulfillmentType: PublicFulfillmentType,
  locale: AppLocale = "zh-TW",
) {
  return publicOrderMessages.get(
    locale,
    fulfillmentType === "TAKEOUT"
      ? "helpTakeout"
      : fulfillmentType === "DINE_IN"
        ? "helpDineIn"
        : "helpDelivery",
  );
}

export function OrderHelpPanel({
  fulfillmentType,
  isOnline,
  isRefreshing,
  onRefresh,
  locale = "zh-TW",
}: {
  fulfillmentType: PublicFulfillmentType;
  isOnline: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  locale?: AppLocale;
}) {
  return (
    <details className="group mt-6 rounded-md border border-stone-200 bg-stone-50">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-stone-900 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <CircleHelp aria-hidden="true" className="h-5 w-5 text-teal-700" />
          {publicOrderMessages.get(locale, "helpTitle")}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-stone-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-stone-200 px-4 py-4 text-sm text-stone-700">
        <p className="leading-6">{getOrderHelpGuidance(fulfillmentType, locale)}</p>
        {!isOnline ? (
          <p role="status" aria-live="polite" className="mt-3 text-amber-800">
            {publicOrderMessages.get(locale, "offlineRefresh")}
          </p>
        ) : null}
        <button
          type="button"
          aria-label={publicOrderMessages.get(locale, "helpRefreshAria")}
          disabled={!isOnline || isRefreshing}
          onClick={onRefresh}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 bg-white px-4 font-semibold text-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? publicOrderMessages.get(locale, "refreshing") : publicOrderMessages.get(locale, "refreshOrder")}
        </button>
      </div>
    </details>
  );
}

export function formatOrderRefreshTime(updatedAt: Date, locale: AppLocale = "zh-TW") {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(updatedAt);
}

export function OrderAmendmentNoticeDialog({
  notice,
  locale = "zh-TW",
  currency = "TWD",
  onDismiss,
}: {
  notice: OrderAmendmentNotice;
  locale?: AppLocale;
  currency?: string;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-stone-950/65 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-amendment-dialog-title"
        className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <button
          type="button"
          aria-label={publicOrderMessages.get(locale, "amendmentDismiss")}
          onClick={onDismiss}
          className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-stone-500 hover:bg-stone-100"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        <FilePenLine aria-hidden="true" className="h-10 w-10 text-amber-700" />
        <h2 id="order-amendment-dialog-title" className="mt-3 pr-10 text-xl font-bold text-stone-950">
          {publicOrderMessages.get(locale, "amendmentTitle")}
        </h2>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          {notice.message}
        </p>
        {notice.previousTotal !== null && notice.total !== null
          ? (
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt className="text-stone-500">{publicOrderMessages.get(locale, "amendmentPreviousTotal")}</dt>
              <dd className="text-right text-stone-500 line-through">{formatMoney(notice.previousTotal, currency, locale)}</dd>
              <dt className="font-semibold text-stone-900">{publicOrderMessages.get(locale, "amendmentNewTotal")}</dt>
              <dd className="text-right font-bold text-teal-800">{formatMoney(notice.total, currency, locale)}</dd>
            </dl>
          )
          : null}
        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 min-h-12 w-full rounded-md bg-teal-700 px-4 font-semibold text-white"
        >
          {publicOrderMessages.get(locale, "amendmentDismiss")}
        </button>
      </section>
    </div>
  );
}

const fulfillmentTimeStateMessageKeys = {
  NOT_REQUESTED: "fulfillmentStateNotRequested",
  REQUESTED: "fulfillmentStateRequested",
  CONFIRMED: "fulfillmentStateConfirmed",
  CUSTOMER_ACTION_REQUIRED: "fulfillmentStateAction",
  DECLINED: "fulfillmentStateDeclined",
  EXPIRED: "fulfillmentStateExpired",
} as const;

type FulfillmentFeedback = {
  kind: "success" | "error";
  message: string;
};

function formatFulfillmentTime(
  value: string | null,
  timeZone: string | null,
  locale: AppLocale,
) {
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
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: "Asia/Taipei",
    }).format(date);
  }
}

export function formatNoteOptions(
  locale: AppLocale,
  noteOptions: Array<{ groupName: string; optionName: string }>,
) {
  const usesCjkPunctuation = locale === "zh-TW" || locale === "ja";
  const pairSeparator = usesCjkPunctuation ? "：" : ": ";
  const optionSeparator = usesCjkPunctuation ? "、" : ", ";
  const groupSeparator = usesCjkPunctuation ? "；" : " · ";
  const groups = new Map<string, string[]>();
  for (const option of noteOptions) {
    const options = groups.get(option.groupName) ?? [];
    options.push(option.optionName);
    groups.set(option.groupName, options);
  }
  return [...groups]
    .map(([groupName, options]) => `${groupName}${pairSeparator}${options.join(optionSeparator)}`)
    .join(groupSeparator);
}

function FulfillmentTimePanel({
  order,
  feedback,
  isResponding,
  onRespond,
  locale,
}: {
  order: PublicOrder;
  feedback: FulfillmentFeedback | null;
  isResponding: boolean;
  onRespond: (response: "ACCEPT" | "DECLINE") => void;
  locale: AppLocale;
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

  const timeLabel = publicOrderMessages.get(
    locale,
    order.fulfillmentType === "DELIVERY" ? "deliveryTime" : "pickupTime",
  );
  const requestedAt = formatFulfillmentTime(order.requestedFulfillmentAt, order.stallTimezone, locale);
  const committedAt = formatFulfillmentTime(order.committedFulfillmentAt, order.stallTimezone, locale);
  const pendingAt = formatFulfillmentTime(order.pendingFulfillmentAt, order.stallTimezone, locale);
  const responseExpiresAt = formatFulfillmentTime(
    order.fulfillmentTimeResponseExpiresAt,
    order.stallTimezone,
    locale,
  );
  const canRespond = order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED"
    && order.fulfillmentTimeVersion >= 1
    && pendingAt !== null;

  return (
    <section aria-labelledby="fulfillment-time-heading" className="mt-5 rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-stone-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="fulfillment-time-heading" className="font-semibold text-stone-900">{publicOrderMessages.get(locale, "expectedTime", { type: timeLabel })}</h2>
          <p className="mt-1 text-xs text-teal-800">{publicOrderMessages.get(locale, fulfillmentTimeStateMessageKeys[order.fulfillmentTimeState])}</p>
        </div>
        {order.fulfillmentTimeVersion > 0
          ? <span className="shrink-0 text-xs text-stone-500">{publicOrderMessages.get(locale, "proposalVersion", { version: order.fulfillmentTimeVersion })}</span>
          : null}
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-stone-500">{publicOrderMessages.get(locale, "originalChoice")}</dt>
        <dd className="font-medium text-stone-900">{requestedAt ?? publicOrderMessages.get(locale, "unspecified")}</dd>
        <dt className="text-stone-500">{publicOrderMessages.get(locale, "currentConfirmed")}</dt>
        <dd className="font-medium text-stone-900">{committedAt ?? publicOrderMessages.get(locale, "notConfirmed")}</dd>
        {order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED"
          ? (
            <>
              <dt className="text-stone-500">{publicOrderMessages.get(locale, "merchantProposal")}</dt>
              <dd className="font-semibold text-teal-900">{pendingAt ?? publicOrderMessages.get(locale, "timeInvalid")}</dd>
            </>
          )
          : null}
      </dl>

      {order.fulfillmentTimeChangeReason
        ? <p className="mt-3 rounded bg-white/70 px-3 py-2">{publicOrderMessages.get(locale, "merchantReason", { reason: order.fulfillmentTimeChangeReason })}</p>
        : null}
      {canRespond
        ? (
          <div className="mt-4">
            {responseExpiresAt
              ? <p className="text-xs text-stone-500">{publicOrderMessages.get(locale, "replyBy", { time: responseExpiresAt })}</p>
              : null}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={isResponding}
                onClick={() => onRespond("ACCEPT")}
                className="rounded-md bg-teal-700 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResponding ? publicOrderMessages.get(locale, "submitting") : publicOrderMessages.get(locale, "acceptNewTime", { type: timeLabel })}
              </button>
              <button
                type="button"
                disabled={isResponding}
                onClick={() => onRespond("DECLINE")}
                className="rounded-md border border-stone-300 bg-white px-4 py-3 font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {publicOrderMessages.get(locale, "declineTime")}
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
  const { locale } = useAppLocale();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [fulfillmentFeedback, setFulfillmentFeedback] = useState<FulfillmentFeedback | null>(null);
  const [showPickupReadyDialog, setShowPickupReadyDialog] = useState(false);
  const [amendmentNotice, setAmendmentNotice] = useState<OrderAmendmentNotice | null>(null);
  const announcedReadyOrderRef = useRef<string | null>(null);
  const announcedAmendmentRef = useRef<string | null>(null);

  useEffect(() => {
    const prime = () => void primeAlertSound();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

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
        ? publicOrderMessages.get(locale, "orderNotFound")
        : typeof payload.code === "string"
          ? localizedPublicOrderError(locale, payload.code)
          : publicOrderMessages.get(locale, "updateError"));
    }
    const publicOrder = payload.order as unknown as PublicOrder;
    return {
      value: {
        ...publicOrder,
        publicMenuIdentifier: publicOrder.publicMenuIdentifier ?? null,
        stallTimezone: publicOrder.stallTimezone ?? null,
        requestedFulfillmentAt: publicOrder.requestedFulfillmentAt ?? null,
        committedFulfillmentAt: publicOrder.committedFulfillmentAt ?? null,
        pendingFulfillmentAt: publicOrder.pendingFulfillmentAt ?? null,
        fulfillmentTimeState: publicOrder.fulfillmentTimeState ?? "NOT_REQUESTED",
        fulfillmentTimeVersion: publicOrder.fulfillmentTimeVersion ?? 0,
        fulfillmentTimeResponseExpiresAt: publicOrder.fulfillmentTimeResponseExpiresAt ?? null,
        fulfillmentTimeChangeReason: publicOrder.fulfillmentTimeChangeReason ?? null,
        currency: publicOrder.currency ?? "TWD",
        merchantAmendment: publicOrder.merchantAmendment ?? null,
      },
    };
  }, [locale, trackingToken]);

  const { refresh: refreshOrder } = useLiveResource<PublicOrder>({
    resourceKey: trackingToken,
    intervalMs: 3_000,
    load: loadOrder,
    onData: (nextOrder) => {
      setOrder(nextOrder);
      setLastUpdatedAt(new Date());
      setMessage("");
      if (
        nextOrder.merchantAmendment
        && announcedAmendmentRef.current !== nextOrder.merchantAmendment.id
      ) {
        announcedAmendmentRef.current = nextOrder.merchantAmendment.id;
        setAmendmentNotice(nextOrder.merchantAmendment);
        void playAlertSound({ preset: "CHIME", volume: 100, repeatCount: 2 });
      }
      if (
        nextOrder.fulfillmentType === "TAKEOUT"
        && nextOrder.orderStatus === "READY"
        && announcedReadyOrderRef.current !== nextOrder.orderNo
      ) {
        announcedReadyOrderRef.current = nextOrder.orderNo;
        setShowPickupReadyDialog(true);
        void playAlertSound({ preset: "URGENT", volume: 100, repeatCount: 3 });
      }
    },
    onError: (error) => {
      setMessage(error instanceof Error
        ? error.message
        : publicOrderMessages.get(locale, "updateError"));
    },
    onLoadingChange: setIsLoading,
    onOnlineChange: (online) => {
      setIsOnline(online);
      if (!online) {
        setMessage(publicOrderMessages.get(locale, "offlineAuto"));
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
        throw new Error(
          typeof payload.code === "string"
            ? localizedPublicOrderError(locale, payload.code)
            : publicOrderMessages.get(locale, "timeConfirmError"),
        );
      }
      setFulfillmentFeedback({
        kind: "success",
        message: responseValue === "ACCEPT"
          ? publicOrderMessages.get(locale, "timeAccepted")
          : publicOrderMessages.get(locale, "timeDeclined"),
      });
      await refreshOrder();
    } catch (error) {
      setFulfillmentFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : publicOrderMessages.get(locale, "timeConfirmError"),
      });
    } finally {
      setIsResponding(false);
    }
  }, [locale, order, refreshOrder, trackingToken]);

  const cancelOrder = useCallback(async () => {
    if (!window.confirm(publicOrderMessages.get(locale, "cancelConfirm"))) return;
    setIsCancelling(true);
    setMessage("");
    try {
      const operationId = createPublicOrderOperationId();
      const response = await fetch(`/api/public/orders/${encodeURIComponent(trackingToken)}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...publicOrderCircuitHeaders(operationId),
        },
        body: JSON.stringify({ deviceId: getOrCreateDeviceId() }),
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      const payload = await parseEdgeResponse(response);
      if (!response.ok) {
        throw new Error(typeof payload.code === "string"
          ? localizedPublicOrderError(locale, payload.code)
          : publicOrderMessages.get(locale, "cancelFailed"));
      }
      await refreshOrder();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : publicOrderMessages.get(locale, "cancelFailed"));
    } finally {
      setIsCancelling(false);
    }
  }, [locale, refreshOrder, trackingToken]);

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-6 sm:px-5 sm:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-800">{publicOrderMessages.get(locale, "liveStatus")}</p>
          <h1 className="mt-1 text-3xl font-semibold">{order?.stallName ?? "StallOrder"}</h1>
          <p className="mt-2 text-xs text-stone-500">
            {!isOnline
              ? publicOrderMessages.get(locale, "offlineAuto")
              : isLoading
                ? order ? publicOrderMessages.get(locale, "updating") : publicOrderMessages.get(locale, "loading")
                : lastUpdatedAt
                  ? publicOrderMessages.get(locale, "lastUpdated", { time: formatOrderRefreshTime(lastUpdatedAt, locale) })
                  : publicOrderMessages.get(locale, "waitingUpdate")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {order
            && order.fulfillmentType !== "DINE_IN"
            && order.publicMenuIdentifier
            ? (
              <button
                type="button"
                onClick={() => window.location.assign(`/store/${encodeURIComponent(order.publicMenuIdentifier!)}?fresh=${Date.now()}`)}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 bg-white px-3 text-sm font-semibold text-teal-800"
              >
                <Store aria-hidden="true" className="h-4 w-4" />
                {publicOrderMessages.get(locale, "returnMenu")}
              </button>
            )
            : null}
          <button type="button" title={publicOrderMessages.get(locale, "refresh")} aria-label={publicOrderMessages.get(locale, "refreshAria")} disabled={isLoading || !isOnline} onClick={() => void refreshOrder()} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
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
              <div className="text-sm text-stone-500">{publicOrderMessages.get(locale, "orderNumber", { number: order.orderNo })}</div>
              <div className="text-xl font-semibold">{getPublicOrderStatusLabel(order.orderStatus, order.fulfillmentType, locale)}</div>
            </div>
          </div>
          <OrderProgressPanel
            orderStatus={order.orderStatus}
            fulfillmentType={order.fulfillmentType}
            locale={locale}
          />
          <div className="mt-5 grid grid-cols-2 gap-4 sm:mt-7 sm:gap-5">
            <div>
              <div className="text-xs text-stone-500">{publicOrderMessages.get(locale, order.fulfillmentType === "DINE_IN" ? "tableLabel" : order.fulfillmentType === "DELIVERY" ? "addressLabel" : "pickupCodeLabel")}</div>
              <div data-testid={order.fulfillmentType === "TAKEOUT" ? "pickup-code" : undefined} className={`mt-1 font-semibold ${order.fulfillmentType === "TAKEOUT" ? "font-mono text-3xl tracking-normal" : "break-words text-base"}`}>{order.fulfillmentType === "DINE_IN" ? order.tableLabel : order.fulfillmentType === "DELIVERY" ? order.deliveryAddress : order.pickupVerificationCode}</div>
              {order.fulfillmentType === "DELIVERY" && order.customerPhone ? <div className="mt-1 text-xs text-stone-500">{order.customerPhone}</div> : null}
            </div>
            <div>
              <div className="text-xs text-stone-500">{publicOrderMessages.get(locale, "paymentStatus")}</div>
              <div className="mt-2 font-semibold">{publicOrderMessages.get(locale, order.paymentStatus === "PAID" ? "paid" : "unpaid")}</div>
            </div>
          </div>
          <div className="mt-5 rounded-md bg-stone-50 px-4 py-3 text-sm text-stone-700">
            {order.orderStatus === "READY" || order.orderStatus === "COMPLETED"
              ? publicOrderMessages.get(locale, order.fulfillmentType === "DELIVERY" ? "readyDelivery" : "readyOther")
              : (order.quotedWaitMinutes ?? order.estimatedWaitMinutes) > 0
                ? publicOrderMessages.get(locale, "waitEstimate", { minutes: order.quotedWaitMinutes ?? order.estimatedWaitMinutes })
                : publicOrderMessages.get(locale, "immediate")}
            {order.quotedReadyAt && !["READY", "COMPLETED", "CANCELLED", "EXPIRED"].includes(order.orderStatus)
              ? <div className="mt-1 text-xs text-stone-500">{publicOrderMessages.get(locale, "quotedReady", { time: new Date(order.quotedReadyAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })}</div>
              : null}
            {order.fulfillmentType === "DINE_IN" && order.lastTableOrderAt ? <div className="mt-1 text-xs text-stone-500">{publicOrderMessages.get(locale, "lastTableOrder", { time: new Date(order.lastTableOrderAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })}</div> : null}
          </div>
          <FulfillmentTimePanel
            order={order}
            feedback={fulfillmentFeedback}
            isResponding={isResponding}
            onRespond={(response) => void respondToProposal(response)}
            locale={locale}
          />
          <div className="mt-6 divide-y divide-stone-100 border-y border-stone-200">{order.items.map((item) => <div key={item.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto]"><div><span>{item.quantity} × {item.name}</span>{item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{formatNoteOptions(locale, item.noteOptions)}</p> : null}{item.note ? <p className="mt-1 text-xs text-stone-500">{publicOrderMessages.get(locale, "itemNote", { note: item.note })}</p> : null}</div><span className="font-medium text-stone-600">{publicOrderMessages.get(locale, itemStatusMessageKeys[item.status])}</span></div>)}</div>
          {(() => {
            const actions = getPublicOrderCustomerActions(order.orderStatus, order.fulfillmentType, order.paymentStatus);
            if (!actions.canModify && !actions.canCancel) return null;
            return (
              <section aria-label={publicOrderMessages.get(locale, "orderActions")} className="mt-5 rounded-md border border-stone-200 bg-stone-50 p-4">
                <div className="flex flex-wrap gap-2">
                  {actions.canModify ? (
                    <Link href={`/order/${encodeURIComponent(trackingToken)}/reorder`} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white">
                      <FilePenLine aria-hidden="true" className="h-4 w-4" />{publicOrderMessages.get(locale, "modifyOrder")}
                    </Link>
                  ) : null}
                  {actions.canCancel ? (
                    <button type="button" disabled={isCancelling} onClick={() => void cancelOrder()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 disabled:opacity-50">
                      {isCancelling ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Trash2 aria-hidden="true" className="h-4 w-4" />}
                      {publicOrderMessages.get(locale, isCancelling ? "cancellingOrder" : "cancelOrder")}
                    </button>
                  ) : null}
                </div>
                <p className="mt-3 text-xs leading-5 text-stone-600">
                  {publicOrderMessages.get(locale, order.orderStatus === "CONFIRMED" ? "modifyConfirmedNotice" : "modifyWaitingNotice")}
                </p>
              </section>
            );
          })()}
          {order.fulfillmentType === "TAKEOUT" ? <p className="mt-5 text-sm leading-6 text-stone-600">{publicOrderMessages.get(locale, "takeoutNotice")}</p> : null}
          <OrderHelpPanel
            fulfillmentType={order.fulfillmentType}
            isOnline={isOnline}
            isRefreshing={isLoading}
            onRefresh={() => void refreshOrder()}
            locale={locale}
          />
          <LineNotificationControls trackingToken={trackingToken} />
        </section>
      ) : null}
      {showPickupReadyDialog && order?.fulfillmentType === "TAKEOUT" && order.pickupVerificationCode
        ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-stone-950/65 p-4" role="presentation">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="pickup-ready-dialog-title"
              className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
            >
              <button
                type="button"
                aria-label={publicOrderMessages.get(locale, "pickupReadyDismiss")}
                onClick={() => setShowPickupReadyDialog(false)}
                className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-stone-500 hover:bg-stone-100"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
              <BadgeCheck aria-hidden="true" className="mx-auto h-12 w-12 text-teal-700" />
              <h2 id="pickup-ready-dialog-title" className="mt-3 text-2xl font-bold text-stone-950">
                {publicOrderMessages.get(locale, "pickupReadyTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {publicOrderMessages.get(locale, "pickupReadyBody")}
              </p>
              <div className="mt-5 rounded-xl bg-teal-50 px-4 py-5">
                <p className="text-xs font-semibold text-teal-800">{publicOrderMessages.get(locale, "pickupCodeLabel")}</p>
                <p data-testid="pickup-ready-dialog-code" className="mt-1 font-mono text-5xl font-black tracking-widest text-teal-950">
                  {order.pickupVerificationCode}
                </p>
              </div>
              <p className="mt-3 text-sm font-medium text-stone-700">
                {publicOrderMessages.get(locale, "pickupReadyCodeHint")}
              </p>
              <button
                type="button"
                onClick={() => setShowPickupReadyDialog(false)}
                className="mt-5 min-h-12 w-full rounded-md bg-teal-700 px-4 font-semibold text-white"
              >
                {publicOrderMessages.get(locale, "pickupReadyDismiss")}
              </button>
            </section>
          </div>
        )
        : null}
      {amendmentNotice
        ? (
          <OrderAmendmentNoticeDialog
            notice={amendmentNotice}
            locale={locale}
            currency={order?.currency ?? "TWD"}
            onDismiss={() => setAmendmentNotice(null)}
          />
        )
        : null}
    </main>
  );
}
