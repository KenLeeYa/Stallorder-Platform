"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CancellationReason, UserRole } from "@prisma/client";
import {
  CheckCheck,
  Clock3,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { KitchenNavigation } from "@/components/kitchen-navigation";
import { useOperationsLocale } from "@/components/operations-locale";
import { csrfHeaders } from "@/lib/csrf-client";
import { cancellationReasonOptions } from "@/lib/cancellation-reasons";
import { deliveryProviderLabel } from "@/lib/delivery-platform-labels";
import { resolveEffectiveFulfillmentAt } from "@/lib/fulfillment-time-client";
import type { AppLocale } from "@/lib/app-locale";
import { formatAppDateTime } from "@/lib/locale-format";
import {
  getOperationsErrorMessage,
  type OperationsMessageKey,
} from "@/lib/messages/operations";
import {
  aggregateKitchenItems,
  kitchenWaitDisplay,
  kitchenWaitLevel,
  type KitchenBoardMode,
  type KitchenBoardTask,
  type KitchenTaskState,
} from "@/lib/kitchen-board-contract";
import type { WorkModeDestination } from "@/lib/work-mode";

type BoardData = {
  settings: {
    warningMinutes: number;
    criticalMinutes: number;
    defaultView: KitchenBoardMode;
    timeZone: string;
    businessDayCutoffHour: number;
  };
  stations: Array<{ id: string; name: string; code: string }>;
  tasks: KitchenBoardTask[];
  futureReservations: KitchenBoardTask[];
  serverNow: string;
};

type Props = {
  stall: { id: string; organizationId: string; slug: string; name: string };
  canManage: boolean;
  workModeDestinations: WorkModeDestination[];
  initialData: BoardData;
  role: UserRole;
};

type PendingCancellation = {
  orderId: string;
  orderNo: string;
  reason: CancellationReason;
  detail: string;
  confirmationOrderNo: string;
};

type CancellationErrors = {
  detail?: string;
  confirmationOrderNo?: string;
  request?: string;
};

export function KitchenBoard({ stall, canManage, workModeDestinations, initialData, role }: Props) {
  const { locale, t } = useOperationsLocale();
  const knownOrderIdsRef = useRef(new Set(initialData.tasks.map((task) => task.orderId)));
  const alertsEnabledRef = useRef(false);
  const [data, setData] = useState(initialData);
  const [mode, setMode] = useState<KitchenBoardMode>(initialData.settings.defaultView);
  const [stationId, setStationId] = useState(initialData.stations[0]?.id ?? "");
  const [now, setNow] = useState(() => Date.parse(initialData.serverNow));
  const [connection, setConnection] = useState<"CONNECTING" | "CONNECTED" | "FALLBACK">("CONNECTING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [pendingCancellation, setPendingCancellation] = useState<PendingCancellation | null>(null);
  const [cancellationErrors, setCancellationErrors] = useState<CancellationErrors>({});
  const cancellationDialogRef = useRef<HTMLDialogElement>(null);
  const cancellationTriggerRef = useRef<HTMLElement | null>(null);
  const cancellationDetailRef = useRef<HTMLTextAreaElement>(null);
  const cancellationConfirmationRef = useRef<HTMLInputElement>(null);
  const cancellationBusyRef = useRef(false);
  const pendingCancellationOrderId = pendingCancellation?.orderId ?? null;

  const notifyNewOrders = useCallback((count: number) => {
    if (!alertsEnabledRef.current) return;
    if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
    playNotificationTone();
    setMessage(t("kitchen.board.newOrders", { count }));
  }, [t]);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setBusyId("refresh");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/kitchen/board`, { cache: "no-store" });
      const payload: BoardData & { error?: string; code?: string } = await response.json();
      if (!response.ok) throw new Error(payload.code
        ? getOperationsErrorMessage(locale, payload.code, "kitchen.board.reloadFailed")
        : t("kitchen.board.reloadFailed"));
      const nextOrderIds = new Set(payload.tasks.map((task) => task.orderId));
      const newOrderCount = [...nextOrderIds].filter((orderId) => !knownOrderIdsRef.current.has(orderId)).length;
      nextOrderIds.forEach((orderId) => knownOrderIdsRef.current.add(orderId));
      setData(payload);
      setNow(Date.parse(payload.serverNow));
      setMessage("");
      if (newOrderCount > 0) notifyNewOrders(newOrderCount);
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : t("kitchen.board.reloadFailed"));
    } finally {
      if (!silent) setBusyId(null);
    }
  }, [locale, notifyNewOrders, stall.slug, t]);

  useEffect(() => {
    const preferenceTimer = window.setTimeout(() => {
      const enabled = window.localStorage.getItem("stallorder_kitchen_order_alerts") === "enabled";
      alertsEnabledRef.current = enabled;
      setAlertsEnabled(enabled);
    }, 0);
    return () => window.clearTimeout(preferenceTimer);
  }, []);

  useEffect(() => {
    const clock = window.setInterval(() => setNow((current) => current + 1_000), 1_000);
    const fallback = window.setInterval(() => void refresh(true), 12_000);
    const stream = new EventSource(`/api/stalls/${stall.slug}/kitchen/stream`);
    const connected = () => setConnection("CONNECTED");
    const changed = () => void refresh(true);
    stream.addEventListener("ready", connected);
    stream.addEventListener("kitchen", changed);
    stream.onerror = () => setConnection("FALLBACK");
    return () => {
      window.clearInterval(clock);
      window.clearInterval(fallback);
      stream.close();
    };
  }, [refresh, stall.slug]);

  useEffect(() => {
    if (!pendingCancellationOrderId) return;
    const dialog = cancellationDialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-cancellation-initial-focus]")?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [pendingCancellationOrderId]);

  async function mutate(body: Record<string, unknown>, busyKey: string) {
    setBusyId(busyKey);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/kitchen/tasks`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; code?: string };
      if (!response.ok) throw new Error(payload.code
        ? getOperationsErrorMessage(locale, payload.code, "kitchen.board.operationFailed")
        : t("kitchen.board.operationFailed"));
      await refresh(true);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("kitchen.board.operationFailed"));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function toggleAlerts() {
    const next = !alertsEnabledRef.current;
    alertsEnabledRef.current = next;
    setAlertsEnabled(next);
    window.localStorage.setItem("stallorder_kitchen_order_alerts", next ? "enabled" : "disabled");
    if (next) playNotificationTone();
  }

  function openCancellation(orderId: string, orderNo: string) {
    if (busyId !== null) return;
    if (document.activeElement instanceof HTMLElement) cancellationTriggerRef.current = document.activeElement;
    setMessage("");
    setCancellationErrors({});
    setPendingCancellation({
      orderId,
      orderNo,
      reason: "SOLD_OUT",
      detail: "",
      confirmationOrderNo: "",
    });
  }

  function finishCancellation() {
    const previousFocus = cancellationTriggerRef.current;
    setPendingCancellation(null);
    setCancellationErrors({});
    window.requestAnimationFrame(() => {
      if (previousFocus?.isConnected && !previousFocus.matches(":disabled")) previousFocus.focus();
    });
  }

  function dismissCancellation() {
    if (cancellationBusyRef.current) return;
    finishCancellation();
  }

  async function confirmCancellation() {
    if (!pendingCancellation || busyId !== null || cancellationBusyRef.current) return;
    const errors: CancellationErrors = {};
    if (pendingCancellation.reason === "OTHER" && !pendingCancellation.detail.trim()) {
      errors.detail = t("kitchen.cancel.detailRequired");
    }
    if (pendingCancellation.confirmationOrderNo.trim() !== pendingCancellation.orderNo) {
      errors.confirmationOrderNo = t("kitchen.cancel.orderNoMismatch", { orderNo: pendingCancellation.orderNo });
    }
    if (Object.keys(errors).length > 0) {
      setCancellationErrors(errors);
      window.requestAnimationFrame(() => {
        if (errors.detail) cancellationDetailRef.current?.focus();
        else cancellationConfirmationRef.current?.focus();
      });
      return;
    }

    cancellationBusyRef.current = true;
    setBusyId(pendingCancellation.orderId);
    setCancellationErrors({});
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${pendingCancellation.orderId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          status: "CANCELLED",
          confirmationOrderNo: pendingCancellation.confirmationOrderNo.trim(),
          cancellationReason: pendingCancellation.reason,
          cancellationDetail: pendingCancellation.detail.trim() || null,
        }),
      });
      const payload = await response.json() as { error?: string; code?: string };
      if (!response.ok) throw new Error(payload.code
        ? getOperationsErrorMessage(locale, payload.code, "kitchen.cancel.failed")
        : t("kitchen.cancel.failed"));
      await refresh(true);
      finishCancellation();
    } catch (error) {
      setCancellationErrors({ request: error instanceof Error ? error.message : t("kitchen.cancel.failed") });
    } finally {
      cancellationBusyRef.current = false;
      setBusyId(null);
    }
  }

  const visibleTasks = mode === "STATION" && stationId
    ? data.tasks.filter((task) => task.station.id === stationId)
    : data.tasks;
  const visibleFutureTasks = mode === "STATION" && stationId
    ? data.futureReservations.filter((task) => task.station.id === stationId)
    : data.futureReservations;
  const groupedOrders = useMemo(() => groupTasksByOrder(visibleTasks), [visibleTasks]);
  const groupedFutureOrders = useMemo(
    () => groupTasksByOrder(visibleFutureTasks),
    [visibleFutureTasks],
  );
  const itemAggregates = useMemo(() => aggregateKitchenItems(visibleTasks), [visibleTasks]);
  const canCancelOrder = ["PLATFORM_ADMIN", "ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "STALL_MANAGER"].includes(role);
  const orderStatusLabels: Record<KitchenBoardTask["orderStatus"], string> = {
    CONFIRMED: t("kitchen.status.confirmed"),
    PREPARING: t("kitchen.status.preparing"),
    PACKING: t("kitchen.status.packing"),
    READY: t("kitchen.status.ready"),
  };

  return (
    <>
      <KitchenNavigation
        active="BOARD"
        stall={stall}
        canManage={canManage}
        workModeDestinations={workModeDestinations}
        boardControls={{
          mode,
          onModeChange: setMode,
          connection,
          alertsEnabled,
          onToggleAlerts: toggleAlerts,
          refreshing: busyId === "refresh",
          disabled: busyId !== null,
          onRefresh: () => void refresh(),
        }}
      />
      <main className="mx-auto max-w-[1600px] px-3 py-3 md:px-6 md:py-6">

      {mode === "STATION" ? (
        <label className="mt-4 block max-w-sm text-sm font-semibold">{t("kitchen.station.filter")}
          <select value={stationId} onChange={(event) => setStationId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
            {data.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
          </select>
        </label>
      ) : null}

      {message ? <p role="alert" className="mt-4 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p> : null}

      {groupedFutureOrders.length > 0 ? (
        <details className="mt-4 rounded-md border border-sky-200 bg-sky-50" data-testid="kds-future-reservations">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-sky-950">
            {t("kitchen.future.summary", { orders: groupedFutureOrders.length, items: visibleFutureTasks.length })}
          </summary>
          <div className="grid gap-3 border-t border-sky-200 p-3 md:grid-cols-2 xl:grid-cols-3">
            {groupedFutureOrders.map((order) => {
              const fulfillmentAt = resolveEffectiveFulfillmentAt(order);
              return <article key={order.id} className="rounded-md border border-sky-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="font-semibold">#{order.orderNo}</h2><p className="mt-1 text-xs text-stone-600">{fulfillmentLabel(t, order.fulfillmentType, order.tableLabel)}</p></div>
                  <time className="text-sm font-semibold text-sky-900">{fulfillmentAt ? formatKitchenDateTime(locale, fulfillmentAt, data.settings.timeZone) : t("kitchen.future.timePending")}</time>
                </div>
                <ul className="mt-3 space-y-1 text-sm text-stone-700">{order.tasks.map((task) => <li key={task.id}>{task.itemName} × {task.quantity}</li>)}</ul>
              </article>;
            })}
          </div>
        </details>
      ) : null}

      {mode === "ITEM" ? (
        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("kitchen.items.aria")}>
          {itemAggregates.map((item) => (
            <article key={item.key} className="rounded-md border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-xs font-semibold text-teal-700">{item.stationName}</p><h2 className="mt-1 text-lg font-semibold">{item.itemName}</h2></div>
                <strong className="text-3xl tabular-nums">× {item.quantity}</strong>
              </div>
              {item.modifiers.length > 0 ? <p className="mt-3 text-sm text-stone-600">{item.modifiers.join("、")}</p> : null}
              {item.itemNote ? <p className="mt-2 text-sm font-medium text-amber-800">{t("staff.order.note", { note: item.itemNote })}</p> : null}
              {item.orderNote ? <p className="mt-2 text-sm font-medium text-amber-900">{t("kitchen.items.orderNote", { note: item.orderNote })}</p> : null}
              <p className="mt-3 text-xs text-stone-500">{t("kitchen.items.orderItems", { count: item.taskIds.length })}</p>
            </article>
          ))}
        </section>
      ) : (
        <div className="mt-5 space-y-7">
          {(["CONFIRMED", "PREPARING", "PACKING", "READY"] as const).map((status) => {
            const orders = groupedOrders.filter((order) => order.status === status);
            if (orders.length === 0) return null;
            return (
              <section key={status}>
                <div className="mb-3 flex items-center gap-2"><h2 className="text-lg font-semibold">{orderStatusLabels[status]}</h2><span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold">{orders.length}</span></div>
                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                  {orders.map((order) => (
                    <OrderTicket
                      key={order.id}
                      order={order}
                      now={now}
                      warningMinutes={data.settings.warningMinutes}
                      criticalMinutes={data.settings.criticalMinutes}
                      timeZone={data.settings.timeZone}
                      busyId={busyId}
                      canCancelOrder={canCancelOrder}
                      onTask={(taskId, nextStatus) => mutate({ operation: "UPDATE_TASK", taskId, status: nextStatus }, taskId)}
                      onComplete={() => mutate({ operation: "COMPLETE_ORDER", orderId: order.id }, order.id)}
                      onCancel={() => openCancellation(order.id, order.orderNo)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {visibleTasks.length === 0 ? (
        <div className="mt-16 text-center text-stone-500"><PackageCheck className="mx-auto h-10 w-10" /><p className="mt-3 font-medium">{t("kitchen.empty")}</p></div>
      ) : null}

      {pendingCancellation ? <dialog
        ref={cancellationDialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kds-cancellation-title"
        aria-describedby="kds-cancellation-warning"
        onCancel={(event) => {
          if (cancellationBusyRef.current) event.preventDefault();
        }}
        onClose={dismissCancellation}
        data-testid="kds-cancellation-dialog"
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-md overscroll-contain rounded-xl border border-stone-200 bg-white p-0 text-stone-950 shadow-2xl backdrop:bg-stone-950/60"
      >
        <form onSubmit={(event) => { event.preventDefault(); void confirmCancellation(); }} className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-700"><TriangleAlert className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 id="kds-cancellation-title" className="break-words text-lg font-semibold">{t("kitchen.cancel.title", { orderNo: pendingCancellation.orderNo })}</h2>
              <p className="mt-1 text-sm font-medium text-red-800">{t("kitchen.cancel.irreversible")}</p>
            </div>
          </div>
          <p id="kds-cancellation-warning" className="mt-4 text-sm leading-6 text-stone-600">{t("kitchen.cancel.warning")}</p>
          {cancellationErrors.request ? <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{cancellationErrors.request}</p> : null}
          <label className="mt-4 block text-xs font-semibold text-stone-700">{t("kitchen.cancel.reason")}<select value={pendingCancellation.reason} onChange={(event) => {
            const reason = event.target.value as CancellationReason;
            setPendingCancellation((current) => current ? { ...current, reason } : null);
            setCancellationErrors((current) => ({ ...current, detail: undefined, request: undefined }));
          }} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{cancellationReasonOptions.map((option) => <option key={option.value} value={option.value}>{t(cancellationReasonMessageKey(option.value))}</option>)}</select></label>
          <label className="mt-4 block text-xs font-semibold text-stone-700">{t("kitchen.cancel.details")}{pendingCancellation.reason === "OTHER" ? t("kitchen.cancel.required") : t("kitchen.cancel.optional")}<textarea ref={cancellationDetailRef} value={pendingCancellation.detail} maxLength={200} aria-invalid={Boolean(cancellationErrors.detail)} aria-describedby={cancellationErrors.detail ? "kds-cancellation-detail-error" : undefined} onChange={(event) => {
            setPendingCancellation((current) => current ? { ...current, detail: event.target.value } : null);
            setCancellationErrors((current) => ({ ...current, detail: undefined, request: undefined }));
          }} className="mt-1 min-h-20 w-full resize-y rounded-md border border-stone-300 p-3 text-sm" />{cancellationErrors.detail ? <span id="kds-cancellation-detail-error" role="alert" className="mt-1 block text-xs text-red-700">{cancellationErrors.detail}</span> : null}</label>
          <label className="mt-4 block text-xs font-semibold text-stone-700">{t("kitchen.cancel.confirmOrderNo")}<input ref={cancellationConfirmationRef} type="text" autoComplete="off" spellCheck={false} maxLength={32} value={pendingCancellation.confirmationOrderNo} aria-invalid={Boolean(cancellationErrors.confirmationOrderNo)} aria-describedby={`kds-cancellation-order-hint${cancellationErrors.confirmationOrderNo ? " kds-cancellation-order-error" : ""}`} onChange={(event) => {
            setPendingCancellation((current) => current ? { ...current, confirmationOrderNo: event.target.value } : null);
            setCancellationErrors((current) => ({ ...current, confirmationOrderNo: undefined, request: undefined }));
          }} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3 text-sm" /><span id="kds-cancellation-order-hint" className="mt-1 block text-xs font-normal text-stone-500">{t("kitchen.cancel.enterOrderNo", { orderNo: pendingCancellation.orderNo })}</span>{cancellationErrors.confirmationOrderNo ? <span id="kds-cancellation-order-error" role="alert" className="mt-1 block text-xs text-red-700">{cancellationErrors.confirmationOrderNo}</span> : null}</label>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" data-cancellation-initial-focus disabled={busyId !== null} onClick={dismissCancellation} className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-50">{t("common.back")}</button>
            <button type="submit" disabled={busyId !== null} className="min-h-11 rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busyId === pendingCancellation.orderId ? t("kitchen.cancel.processing") : t("kitchen.cancel.confirm")}</button>
          </div>
        </form>
      </dialog> : null}
      </main>
    </>
  );
}

function OrderTicket({ order, now, warningMinutes, criticalMinutes, timeZone, busyId, canCancelOrder, onTask, onComplete, onCancel }: {
  order: ReturnType<typeof groupTasksByOrder>[number];
  now: number;
  warningMinutes: number;
  criticalMinutes: number;
  timeZone: string;
  busyId: string | null;
  canCancelOrder: boolean;
  onTask: (taskId: string, status: "PENDING" | "PREPARING" | "COMPLETED") => Promise<boolean>;
  onComplete: () => Promise<boolean>;
  onCancel: () => void;
}) {
  const { locale, t } = useOperationsLocale();
  const effectiveFulfillmentAt = resolveEffectiveFulfillmentAt(order);
  const productionStartedAt = order.tasks.reduce<number | null>((earliest, task) => {
    if (!task.startedAt) return earliest;
    const startedAt = Date.parse(task.startedAt);
    return earliest === null ? startedAt : Math.min(earliest, startedAt);
  }, null);
  const fallbackStartedAt = productionStartedAt
    ?? Date.parse(order.confirmedAt ?? order.createdAt);
  const wait = kitchenWaitDisplay(
    now,
    order.status === "CONFIRMED" && productionStartedAt === null
      ? effectiveFulfillmentAt?.getTime() ?? null
      : null,
    fallbackStartedAt,
  );
  const elapsed = wait.elapsedMinutes;
  const waitLabel = wait.beforeFulfillment
    ? t("kitchen.wait.until", { minutes: Math.ceil(((effectiveFulfillmentAt?.getTime() ?? now) - now) / 60_000) })
    : effectiveFulfillmentAt && order.status === "CONFIRMED" && productionStartedAt === null
      ? t("kitchen.wait.overdue", { minutes: elapsed })
      : t("kitchen.wait.elapsed", { minutes: elapsed });
  const level = kitchenWaitLevel(elapsed, warningMinutes, criticalMinutes);
  const border = level === "CRITICAL" ? "border-red-500" : level === "WARNING" ? "border-amber-500" : "border-stone-200";
  return (
    <article className={`rounded-md border-2 ${border} bg-white p-4`}>
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-bold">#{order.orderNo}</h3>
            {order.externalProvider ? <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-800">{deliveryProviderLabel(order.externalProvider)}</span> : null}
          </div>
          <p className="mt-1 text-sm text-stone-600">{fulfillmentLabel(t, order.fulfillmentType, order.tableLabel)} · {sourceLabel(t, order.source)}</p>
          {order.externalOrderNumber ? <p className="mt-1 text-xs font-medium text-stone-600">{t("kitchen.order.platformNo", { number: order.externalOrderNumber })}</p> : null}
          {effectiveFulfillmentAt ? <p className="mt-1 text-xs font-medium text-teal-800">{t("kitchen.reservation.time", { time: formatKitchenDateTime(locale, effectiveFulfillmentAt, timeZone) })}</p> : null}
          {order.externalProvider ? <p className="mt-1 text-xs font-medium text-stone-600">{order.riderPickupAt ? t("kitchen.order.riderPickedUp", { time: formatKitchenTime(locale, order.riderPickupAt, timeZone) }) : t("kitchen.order.awaitRider")}</p> : null}
        </div>
        <div className={`text-right ${level === "CRITICAL" ? "text-red-700" : level === "WARNING" ? "text-amber-700" : "text-stone-600"}`}>
          <span className="inline-flex items-center gap-1 text-sm font-semibold"><Clock3 className="h-4 w-4" />{waitLabel}</span>
          {level !== "NORMAL" ? (
            <p className="mt-1 text-xs font-bold" role="status">
              {level === "CRITICAL" ? t("kitchen.wait.critical") : t("kitchen.wait.warning")}
            </p>
          ) : null}
          {order.pickupCode ? <p className="mt-1 font-mono text-lg font-bold">{t("kitchen.order.pickupCode", { code: order.pickupCode })}</p> : null}
        </div>
      </div>
      <div className="divide-y divide-stone-100">
        {order.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            busy={busyId === task.id}
            locked={order.status === "READY"}
            onTask={onTask}
          />
        ))}
      </div>
      {order.note ? <div className="mt-3 flex gap-2 bg-amber-50 p-3 text-sm text-amber-900"><MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" /><span>{order.externalProvider ? t("kitchen.order.platformNote") : ""}{order.note}</span></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {order.tasks.some((task) => task.status !== "COMPLETED") ? (
          <button type="button" disabled={busyId !== null} onClick={() => void onComplete()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCheck className="h-5 w-5" />{t("kitchen.order.complete")}</button>
        ) : null}
        {canCancelOrder ? <button type="button" disabled={busyId !== null} onClick={onCancel} className="min-h-11 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50">{t("common.cancel")}</button> : null}
      </div>
    </article>
  );
}

function TaskRow({ task, busy, locked, onTask }: { task: KitchenBoardTask; busy: boolean; locked: boolean; onTask: (taskId: string, status: "PENDING" | "PREPARING" | "COMPLETED") => Promise<boolean> }) {
  const { t } = useOperationsLocale();
  const action = task.status === "PENDING"
    ? { status: "PREPARING" as const, label: t("kitchen.task.start"), icon: Play }
    : task.status === "PREPARING"
      ? { status: "COMPLETED" as const, label: t("kitchen.task.complete"), icon: PackageCheck }
      : { status: "PENDING" as const, label: t("kitchen.task.return"), icon: RotateCcw };
  const Icon = action.icon;
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold">{task.itemName} × {task.quantity}</p><p className="mt-1 text-xs font-medium text-teal-700">{task.station.name}</p>{task.modifiers.length > 0 ? <p className="mt-1 text-sm text-stone-600">{task.modifiers.join("、")}</p> : null}{task.itemNote ? <p className="mt-1 text-sm text-amber-800">{t("staff.order.note", { note: task.itemNote })}</p> : null}</div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${task.status === "COMPLETED" ? "bg-emerald-100 text-emerald-800" : task.status === "PREPARING" ? "bg-blue-100 text-blue-800" : "bg-stone-100 text-stone-700"}`}>{taskStatusLabel(t, task.status)}</span>
      </div>
      {!locked ? <button type="button" disabled={busy} onClick={() => void onTask(task.id, action.status)} className={`mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-50 ${task.status === "COMPLETED" ? "border border-stone-300 bg-white" : "bg-stone-900 text-white"}`}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}{action.label}</button> : null}
    </div>
  );
}

function groupTasksByOrder(tasks: KitchenBoardTask[]) {
  const groups = new Map<string, { id: string; orderNo: string; pickupCode: string | null; source: string; externalProvider: string | null; externalOrderNumber: string | null; scheduledPickupAt: string | null; requestedFulfillmentAt: string | null; committedFulfillmentAt: string | null; riderPickupAt: string | null; fulfillmentType: KitchenBoardTask["fulfillmentType"]; tableLabel: string | null; note: string | null; status: KitchenBoardTask["orderStatus"]; createdAt: string; confirmedAt: string | null; tasks: KitchenBoardTask[] }>();
  for (const task of tasks) {
    const current = groups.get(task.orderId);
    if (current) current.tasks.push(task);
    else groups.set(task.orderId, { id: task.orderId, orderNo: task.orderNo, pickupCode: task.pickupCode, source: task.source, externalProvider: task.externalProvider, externalOrderNumber: task.externalOrderNumber, scheduledPickupAt: task.scheduledPickupAt, requestedFulfillmentAt: task.requestedFulfillmentAt, committedFulfillmentAt: task.committedFulfillmentAt, riderPickupAt: task.riderPickupAt, fulfillmentType: task.fulfillmentType, tableLabel: task.tableLabel, note: task.orderNote, status: task.orderStatus, createdAt: task.orderCreatedAt, confirmedAt: task.confirmedAt, tasks: [task] });
  }
  return [...groups.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function formatKitchenTime(locale: AppLocale, value: string, timeZone: string) {
  return formatAppDateTime(locale, value, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function formatKitchenDateTime(locale: AppLocale, value: Date | string, timeZone: string) {
  return formatAppDateTime(locale, value, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

function taskStatusLabel(
  t: (key: OperationsMessageKey, values?: Record<string, string | number>) => string,
  status: KitchenTaskState,
) {
  if (status === "PREPARING") return t("kitchen.status.preparing");
  if (status === "COMPLETED") return t("kitchen.status.ready");
  if (status === "CANCELLED") return t("staff.status.cancelled");
  return t("kitchen.status.confirmed");
}

function fulfillmentLabel(
  t: (key: OperationsMessageKey, values?: Record<string, string | number>) => string,
  type: KitchenBoardTask["fulfillmentType"],
  tableLabel: string | null,
) {
  if (type === "DINE_IN") return tableLabel
    ? t("kitchen.fulfillment.dineInTable", { table: tableLabel })
    : t("kitchen.fulfillment.dineIn");
  if (type === "DELIVERY") return t("kitchen.fulfillment.delivery");
  return t("kitchen.fulfillment.takeout");
}

function sourceLabel(
  t: (key: OperationsMessageKey, values?: Record<string, string | number>) => string,
  source: string,
) {
  if (source === "QR_MENU") return t("kitchen.source.qr");
  if (source === "STAFF_POS") return t("kitchen.source.staff");
  if (source.includes("DELIVERY")) return t("kitchen.source.delivery");
  return t("kitchen.source.walkIn");
}

function cancellationReasonMessageKey(reason: CancellationReason): OperationsMessageKey {
  if (reason === "SOLD_OUT") return "cancelReason.soldOut";
  if (reason === "CUSTOMER_CANCELLED") return "cancelReason.customer";
  if (reason === "WAIT_TOO_LONG") return "cancelReason.wait";
  if (reason === "DUPLICATE_ORDER") return "cancelReason.duplicate";
  return "cancelReason.other";
}

function playNotificationTone() {
  try {
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Mobile browsers can block audio until the user enables alerts.
  }
}
