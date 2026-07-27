"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserRole } from "@prisma/client";
import {
  CheckCheck,
  ChefHat,
  Clock3,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
  Play,
  RefreshCw,
  RotateCcw,
  Rows3,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { PwaControls } from "@/components/pwa-controls";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  aggregateKitchenItems,
  kitchenWaitLevel,
  type KitchenBoardMode,
  type KitchenBoardTask,
  type KitchenTaskState,
} from "@/lib/kitchen-contract";

type BoardData = {
  settings: { warningMinutes: number; criticalMinutes: number; defaultView: KitchenBoardMode };
  stations: Array<{ id: string; name: string; code: string }>;
  tasks: KitchenBoardTask[];
  serverNow: string;
};

type Props = {
  stall: { slug: string; name: string };
  initialData: BoardData;
  role: UserRole;
};

const orderStatusLabels: Record<KitchenBoardTask["orderStatus"], string> = {
  CONFIRMED: "待製作",
  PREPARING: "製作中",
  PACKING: "包裝中",
  READY: "已完成",
};

export function KitchenBoard({ stall, initialData, role }: Props) {
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

  const notifyNewOrders = useCallback((count: number) => {
    if (!alertsEnabledRef.current) return;
    if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
    playNotificationTone();
    setMessage(count === 1 ? "收到 1 筆新廚房訂單。" : `收到 ${count} 筆新廚房訂單。`);
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setBusyId("refresh");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/kitchen/board`, { cache: "no-store" });
      const payload: BoardData & { error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "無法重新載入生產看板。");
      const nextOrderIds = new Set(payload.tasks.map((task) => task.orderId));
      const newOrderCount = [...nextOrderIds].filter((orderId) => !knownOrderIdsRef.current.has(orderId)).length;
      nextOrderIds.forEach((orderId) => knownOrderIdsRef.current.add(orderId));
      setData(payload);
      setNow(Date.parse(payload.serverNow));
      setMessage("");
      if (newOrderCount > 0) notifyNewOrders(newOrderCount);
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "無法重新載入生產看板。");
    } finally {
      if (!silent) setBusyId(null);
    }
  }, [notifyNewOrders, stall.slug]);

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

  async function mutate(body: Record<string, unknown>, busyKey: string) {
    setBusyId(busyKey);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/kitchen/tasks`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "KDS 操作失敗。");
      await refresh(true);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "KDS 操作失敗。");
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

  const visibleTasks = mode === "STATION" && stationId
    ? data.tasks.filter((task) => task.station.id === stationId)
    : data.tasks;
  const groupedOrders = useMemo(() => groupTasksByOrder(visibleTasks), [visibleTasks]);
  const itemAggregates = useMemo(() => aggregateKitchenItems(visibleTasks), [visibleTasks]);
  const canCancelOrder = ["PLATFORM_ADMIN", "ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "STALL_MANAGER"].includes(role);

  return (
    <main className="mx-auto max-w-[1600px] px-3 py-4 md:px-6 md:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
        <div className="inline-flex min-h-11 overflow-hidden rounded-md border border-stone-300 bg-white" role="group" aria-label="看板模式">
          <ModeButton active={mode === "ORDER"} icon={Rows3} label="訂單" onClick={() => setMode("ORDER")} />
          <ModeButton active={mode === "ITEM"} icon={ListChecks} label="品項" onClick={() => setMode("ITEM")} />
          <ModeButton active={mode === "STATION"} icon={ChefHat} label="工作站" onClick={() => setMode("STATION")} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span title={connection === "CONNECTED" ? "廚房即時更新已連線" : "即時連線未就緒，已啟用 12 秒輪詢備援"} className={`inline-flex min-h-10 items-center gap-2 text-sm font-medium ${connection === "CONNECTED" ? "text-emerald-700" : "text-amber-700"}`}>
            {connection === "CONNECTED" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            <span>{connection === "CONNECTED" ? "即時連線" : connection === "CONNECTING" ? "連線中" : "輪詢備援"}</span>
          </span>
          <button type="button" role="switch" aria-checked={alertsEnabled} onClick={toggleAlerts} title={alertsEnabled ? "關閉新訂單聲音與震動" : "開啟新訂單聲音與震動"} className={`grid h-11 w-11 place-items-center rounded-md border ${alertsEnabled ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600"}`}>
            {alertsEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            <span className="sr-only">{alertsEnabled ? "新訂單提醒已開啟" : "新訂單提醒已關閉"}</span>
          </button>
          <PwaControls showWakeLock />
          <button type="button" title="重新整理" disabled={busyId !== null} onClick={() => void refresh()} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-50">
            <RefreshCw className={`h-5 w-5 ${busyId === "refresh" ? "animate-spin" : ""}`} />
            <span className="sr-only">重新整理</span>
          </button>
          <LogoutButton />
        </div>
      </div>

      {mode === "STATION" ? (
        <label className="mt-4 block max-w-sm text-sm font-semibold">工作站
          <select value={stationId} onChange={(event) => setStationId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
            {data.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
          </select>
        </label>
      ) : null}

      {message ? <p role="alert" className="mt-4 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p> : null}

      {mode === "ITEM" ? (
        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="品項彙總">
          {itemAggregates.map((item) => (
            <article key={item.key} className="rounded-md border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-xs font-semibold text-teal-700">{item.stationName}</p><h2 className="mt-1 text-lg font-semibold">{item.itemName}</h2></div>
                <strong className="text-3xl tabular-nums">× {item.quantity}</strong>
              </div>
              {item.modifiers.length > 0 ? <p className="mt-3 text-sm text-stone-600">{item.modifiers.join("、")}</p> : null}
              {item.itemNote ? <p className="mt-2 text-sm font-medium text-amber-800">備註：{item.itemNote}</p> : null}
              {item.orderNote ? <p className="mt-2 text-sm font-medium text-amber-900">整單備註：{item.orderNote}</p> : null}
              <p className="mt-3 text-xs text-stone-500">{item.taskIds.length} 張訂單品項</p>
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
                      busyId={busyId}
                      canCancelOrder={canCancelOrder}
                      onTask={(taskId, nextStatus) => mutate({ operation: "UPDATE_TASK", taskId, status: nextStatus }, taskId)}
                      onComplete={() => mutate({ operation: "COMPLETE_ORDER", orderId: order.id }, order.id)}
                      onCancel={() => cancelOrder(stall.slug, order.id, order.orderNo, refresh, setMessage, setBusyId)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {visibleTasks.length === 0 ? (
        <div className="mt-16 text-center text-stone-500"><PackageCheck className="mx-auto h-10 w-10" /><p className="mt-3 font-medium">目前沒有待處理的生產工作</p></div>
      ) : null}
    </main>
  );
}

function OrderTicket({ order, now, warningMinutes, criticalMinutes, busyId, canCancelOrder, onTask, onComplete, onCancel }: {
  order: ReturnType<typeof groupTasksByOrder>[number];
  now: number;
  warningMinutes: number;
  criticalMinutes: number;
  busyId: string | null;
  canCancelOrder: boolean;
  onTask: (taskId: string, status: "PENDING" | "PREPARING" | "COMPLETED") => Promise<boolean>;
  onComplete: () => Promise<boolean>;
  onCancel: () => void;
}) {
  const elapsed = Math.max(0, Math.floor((now - Date.parse(order.confirmedAt ?? order.createdAt)) / 60_000));
  const level = kitchenWaitLevel(elapsed, warningMinutes, criticalMinutes);
  const border = level === "CRITICAL" ? "border-red-500" : level === "WARNING" ? "border-amber-500" : "border-stone-200";
  return (
    <article className={`rounded-md border-2 ${border} bg-white p-4`}>
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 pb-3">
        <div><h3 className="text-xl font-bold">#{order.orderNo}</h3><p className="mt-1 text-sm text-stone-600">{fulfillmentLabel(order.fulfillmentType, order.tableLabel)} · {sourceLabel(order.source)}</p></div>
        <div className={`text-right ${level === "CRITICAL" ? "text-red-700" : level === "WARNING" ? "text-amber-700" : "text-stone-600"}`}>
          <span className="inline-flex items-center gap-1 text-sm font-semibold"><Clock3 className="h-4 w-4" />{elapsed} 分</span>
          {level !== "NORMAL" ? (
            <p className="mt-1 text-xs font-bold" role="status">
              {level === "CRITICAL" ? "嚴重逾時" : "等候警示"}
            </p>
          ) : null}
          {order.pickupCode ? <p className="mt-1 font-mono text-lg font-bold">取餐 {order.pickupCode}</p> : null}
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
      {order.note ? <div className="mt-3 flex gap-2 bg-amber-50 p-3 text-sm text-amber-900"><MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" /><span>{order.note}</span></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {order.tasks.some((task) => task.status !== "COMPLETED") ? (
          <button type="button" disabled={busyId !== null} onClick={() => void onComplete()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCheck className="h-5 w-5" />整單完成</button>
        ) : null}
        {canCancelOrder ? <button type="button" disabled={busyId !== null} onClick={onCancel} className="min-h-11 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50">取消</button> : null}
      </div>
    </article>
  );
}

function TaskRow({ task, busy, locked, onTask }: { task: KitchenBoardTask; busy: boolean; locked: boolean; onTask: (taskId: string, status: "PENDING" | "PREPARING" | "COMPLETED") => Promise<boolean> }) {
  const action = task.status === "PENDING"
    ? { status: "PREPARING" as const, label: "開始製作", icon: Play }
    : task.status === "PREPARING"
      ? { status: "COMPLETED" as const, label: "完成品項", icon: PackageCheck }
      : { status: "PENDING" as const, label: "退回待製作", icon: RotateCcw };
  const Icon = action.icon;
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold">{task.itemName} × {task.quantity}</p><p className="mt-1 text-xs font-medium text-teal-700">{task.station.name}</p>{task.modifiers.length > 0 ? <p className="mt-1 text-sm text-stone-600">{task.modifiers.join("、")}</p> : null}{task.itemNote ? <p className="mt-1 text-sm text-amber-800">備註：{task.itemNote}</p> : null}</div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${task.status === "COMPLETED" ? "bg-emerald-100 text-emerald-800" : task.status === "PREPARING" ? "bg-blue-100 text-blue-800" : "bg-stone-100 text-stone-700"}`}>{taskStatusLabel(task.status)}</span>
      </div>
      {!locked ? <button type="button" disabled={busy} onClick={() => void onTask(task.id, action.status)} className={`mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-50 ${task.status === "COMPLETED" ? "border border-stone-300 bg-white" : "bg-stone-900 text-white"}`}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}{action.label}</button> : null}
    </div>
  );
}

function ModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof ChefHat; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`inline-flex min-h-11 items-center gap-2 border-r border-stone-300 px-4 text-sm font-semibold last:border-r-0 ${active ? "bg-teal-50 text-teal-800" : "bg-white text-stone-600"}`}><Icon className="h-4 w-4" />{label}</button>;
}

function groupTasksByOrder(tasks: KitchenBoardTask[]) {
  const groups = new Map<string, { id: string; orderNo: string; pickupCode: string | null; source: string; fulfillmentType: KitchenBoardTask["fulfillmentType"]; tableLabel: string | null; note: string | null; status: KitchenBoardTask["orderStatus"]; createdAt: string; confirmedAt: string | null; tasks: KitchenBoardTask[] }>();
  for (const task of tasks) {
    const current = groups.get(task.orderId);
    if (current) current.tasks.push(task);
    else groups.set(task.orderId, { id: task.orderId, orderNo: task.orderNo, pickupCode: task.pickupCode, source: task.source, fulfillmentType: task.fulfillmentType, tableLabel: task.tableLabel, note: task.orderNote, status: task.orderStatus, createdAt: task.orderCreatedAt, confirmedAt: task.confirmedAt, tasks: [task] });
  }
  return [...groups.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function cancelOrder(stallSlug: string, orderId: string, orderNo: string, refresh: (silent?: boolean) => Promise<void>, setMessage: (message: string) => void, setBusyId: (value: string | null) => void) {
  const confirmation = window.prompt(`為避免誤觸，請輸入訂單編號 ${orderNo} 確認取消。`);
  if (confirmation !== orderNo) {
    if (confirmation !== null) setMessage("訂單編號不符，未取消訂單。");
    return;
  }
  setBusyId(orderId);
  try {
    const response = await fetch(`/api/stalls/${stallSlug}/orders/${orderId}`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify({ status: "CANCELLED", confirmationOrderNo: orderNo, cancellationReason: "OTHER", cancellationDetail: "由 KDS 管理人員取消" }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "無法取消訂單。");
    await refresh(true);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "無法取消訂單。");
  } finally {
    setBusyId(null);
  }
}

function taskStatusLabel(status: KitchenTaskState) {
  if (status === "PREPARING") return "製作中";
  if (status === "COMPLETED") return "已完成";
  if (status === "CANCELLED") return "已取消";
  return "待製作";
}

function fulfillmentLabel(type: KitchenBoardTask["fulfillmentType"], tableLabel: string | null) {
  if (type === "DINE_IN") return tableLabel ? `內用 ${tableLabel}` : "內用";
  if (type === "DELIVERY") return "外送";
  return "外帶";
}

function sourceLabel(source: string) {
  if (source === "QR_MENU") return "QR 點餐";
  if (source === "STAFF_POS") return "店員點餐";
  if (source.includes("DELIVERY")) return "線上外送";
  return "現場訂單";
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
