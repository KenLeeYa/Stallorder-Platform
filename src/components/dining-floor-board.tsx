"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrderItemStatus, OrderStatus, UserRole } from "@prisma/client";
import Link from "next/link";
import { ArrowLeft, CheckCheck, CircleCheck, Clock3, LoaderCircle, RefreshCw, Utensils, Wifi, WifiOff } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { DiningTableShapeGraphic } from "@/components/dining-table-shape";
import { useOperationsLocale } from "@/components/operations-locale";
import { csrfHeaders } from "@/lib/csrf-client";
import { getDiningFloorTabs, type DiningTableShape } from "@/lib/dining-floor";
import { formatAppDateTime } from "@/lib/locale-format";
import { getOperationsErrorMessage } from "@/lib/messages/operations";
import { canTransitionOrderItem } from "@/lib/order-item-status";
import { canTransitionOrder } from "@/lib/rbac";

type FloorTable = {
  id: string;
  floorId: string | null;
  code: string;
  label: string;
  isActive: boolean;
  layoutX: number;
  layoutY: number;
  shape: DiningTableShape;
  rotationDegrees: number;
  serviceState: "EMPTY" | "OCCUPIED" | "NEEDS_CLEANING";
  seatedAt: string | null;
  cleanedAt: string | null;
};

export type DiningFloorOrder = {
  id: string;
  orderNo: string;
  customerName: string;
  diningTableId: string | null;
  tableLabel: string | null;
  fulfillmentType: "TAKEOUT" | "DINE_IN";
  status: OrderStatus;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    note: string | null;
    status: OrderItemStatus;
    noteOptions: Array<{ groupName: string; optionName: string }>;
  }>;
};

type LiveState = "connected" | "fallback";

const tableStatusStyles = {
  EMPTY: "border-stone-300 bg-white text-stone-700",
  WAITING: "border-amber-500 bg-amber-50 text-amber-950",
  PREPARING: "border-orange-500 bg-orange-50 text-orange-950",
  READY: "border-blue-600 bg-blue-50 text-blue-950",
  SERVED: "border-emerald-600 bg-emerald-50 text-emerald-950",
  OCCUPIED: "border-violet-500 bg-violet-50 text-violet-950",
  CLEANING: "border-rose-500 bg-rose-50 text-rose-950",
  INACTIVE: "border-stone-300 bg-stone-200 text-stone-500",
} as const;

function getTableStatus(table: FloorTable, orders: DiningFloorOrder[]) {
  const items = orders.flatMap((order) => order.items);
  const unservedCount = items.filter((item) => item.status !== "SERVED").length;
  if (orders.length === 0 && table.serviceState === "NEEDS_CLEANING") return { key: "CLEANING" as const, unservedCount: 0 };
  if (orders.length === 0 && table.serviceState === "OCCUPIED") return { key: "OCCUPIED" as const, unservedCount: 0 };
  if (orders.length === 0) return { key: "EMPTY" as const, unservedCount: 0 };
  if (orders.some((order) => order.status === "WAITING_CONFIRMATION")) {
    return { key: "WAITING" as const, unservedCount };
  }
  if (items.some((item) => item.status === "READY")) {
    return { key: "READY" as const, unservedCount };
  }
  if (items.some((item) => item.status === "PENDING" || item.status === "PREPARING")) {
    return { key: "PREPARING" as const, unservedCount };
  }
  return { key: "SERVED" as const, unservedCount: 0 };
}

export function DiningFloorBoard({
  stall,
  floors,
  tables,
  initialOrders,
  account,
}: {
  stall: { slug: string; name: string };
  floors: Array<{ id: string; name: string; sortOrder: number }>;
  tables: FloorTable[];
  initialOrders: DiningFloorOrder[];
  account: { displayName: string; role: UserRole };
}) {
  const { locale, t } = useOperationsLocale();
  const [orders, setOrders] = useState(initialOrders);
  const [diningFloors, setDiningFloors] = useState(floors);
  const [floorTables, setFloorTables] = useState(tables);
  const initialFloorTabs = getDiningFloorTabs(floors, tables);
  const [activeFloorKey, setActiveFloorKey] = useState(initialFloorTabs[0]?.key ?? "");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>("fallback");
  const [message, setMessage] = useState("");
  const [busyTableId, setBusyTableId] = useState<string | null>(null);

  const refreshOrders = useCallback(async (showProgress = false) => {
    if (showProgress) setIsRefreshing(true);
    try {
      const [ordersResponse, tablesResponse] = await Promise.all([
        fetch(`/api/stalls/${stall.slug}/orders`, { cache: "no-store" }),
        fetch(`/api/stalls/${stall.slug}/tables`, { cache: "no-store" }),
      ]);
      const [ordersPayload, tablesPayload] = await Promise.all([ordersResponse.json(), tablesResponse.json()]);
      if (!ordersResponse.ok) throw new Error(getOperationsErrorMessage(locale, ordersPayload.code, "dining.error.ordersRefresh"));
      if (!tablesResponse.ok) throw new Error(getOperationsErrorMessage(locale, tablesPayload.code, "dining.error.tablesRefresh"));
      setOrders((ordersPayload.orders as DiningFloorOrder[]).filter((order) => (
        order.fulfillmentType === "DINE_IN" && Boolean(order.diningTableId)
      )));
      setFloorTables(tablesPayload.tables as FloorTable[]);
      setDiningFloors(tablesPayload.floors as Array<{ id: string; name: string; sortOrder: number }>);
      if (showProgress) setMessage("");
    } catch (error) {
      if (showProgress) setMessage(error instanceof Error ? error.message : t("staff.error.network"));
    } finally {
      if (showProgress) setIsRefreshing(false);
    }
  }, [locale, stall.slug, t]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/stalls/${stall.slug}/orders/stream`);
    const refresh = () => void refreshOrders();
    eventSource.addEventListener("ready", () => setLiveState("connected"));
    eventSource.addEventListener("orders", refresh);
    eventSource.onerror = () => setLiveState("fallback");
    const fallbackTimer = window.setInterval(refresh, 5_000);
    const visibilityHandler = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visibilityHandler);
    return () => {
      eventSource.close();
      window.clearInterval(fallbackTimer);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [refreshOrders, stall.slug]);

  async function updateItemStatus(orderId: string, itemId: string, status: Exclude<OrderItemStatus, "PENDING">) {
    setMessage("");
    setBusyItemId(itemId);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}/items/${itemId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getOperationsErrorMessage(locale, payload.code, "dining.error.itemUpdate"));
      replaceOrder(payload.order as DiningFloorOrder);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
    } finally {
      setBusyItemId(null);
    }
  }

  async function updateAllItems(orderId: string, status: "PREPARING" | "READY" | "SERVED") {
    setMessage("");
    setBusyOrderId(orderId);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}/items`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getOperationsErrorMessage(locale, payload.code, "dining.error.bulkUpdate"));
      replaceOrder(payload.order as DiningFloorOrder);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
    } finally {
      setBusyOrderId(null);
    }
  }

  async function confirmOrder(orderId: string) {
    setMessage("");
    setBusyOrderId(orderId);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ status: "CONFIRMED" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getOperationsErrorMessage(locale, payload.code, "dining.error.confirm"));
      replaceOrder(payload.order as DiningFloorOrder);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
    } finally {
      setBusyOrderId(null);
    }
  }

  function replaceOrder(nextOrder: DiningFloorOrder) {
    setOrders((current) => current.map((order) => order.id === nextOrder.id ? nextOrder : order));
  }

  async function updateTableServiceState(tableId: string, serviceState: "EMPTY" | "NEEDS_CLEANING") {
    setBusyTableId(tableId);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/tables/${tableId}/service-state`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ serviceState }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getOperationsErrorMessage(locale, payload.code, "dining.error.tablesRefresh"));
      setFloorTables((current) => current.map((table) => table.id === tableId ? payload.table : table));
      setMessage(serviceState === "EMPTY" ? t("dining.table.cleaned") : t("dining.table.needsCleaning"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
    } finally {
      setBusyTableId(null);
    }
  }

  const ordersByTable = useMemo(() => new Map(floorTables.map((table) => [
    table.id,
    orders.filter((order) => order.diningTableId === table.id),
  ])), [floorTables, orders]);
  const floorTabs = useMemo(() => getDiningFloorTabs(diningFloors, floorTables), [diningFloors, floorTables]);
  const activeFloor = floorTabs.find((floor) => floor.key === activeFloorKey) ?? floorTabs[0] ?? null;
  const visibleTables = floorTables.filter((table) => table.floorId === (activeFloor?.id ?? null));
  const selectedTableCandidate = floorTables.find((table) => table.id === selectedTableId) ?? null;
  const selectedTable = selectedTableCandidate?.floorId === (activeFloor?.id ?? null)
    ? selectedTableCandidate
    : null;
  const selectedOrders = selectedTable ? ordersByTable.get(selectedTable.id) ?? [] : [];
  const selectedTableStatus = selectedTable ? getTableStatus(selectedTable, selectedOrders) : null;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-3 py-4 sm:px-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-teal-800">{t("dining.title")}</p>
          <h1 className="truncate text-2xl font-semibold sm:text-3xl">{stall.name}</h1>
          <p className="mt-1 text-xs text-stone-500">{account.displayName} · {roleLabel(account.role, t)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`hidden items-center gap-1 text-xs sm:inline-flex ${liveState === "connected" ? "text-emerald-700" : "text-amber-700"}`}>
            {liveState === "connected" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {liveState === "connected" ? t("dining.live") : t("dining.auto")}
          </span>
          <button type="button" title={t("dining.refresh")} onClick={() => void refreshOrders(true)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 bg-white">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
          <LogoutButton />
        </div>
      </header>

      <nav className="mt-4">
        <Link href={`/staff/${stall.slug}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-stone-700">
          <ArrowLeft className="h-4 w-4" />{t("dining.back")}
        </Link>
      </nav>
      {message ? <p role="alert" className="mt-2 text-sm text-red-700">{message}</p> : null}

      <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-start">
        <section aria-labelledby="floor-map-heading">
          <div role="tablist" aria-label={t("dining.floors")} className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {floorTabs.map((floor) => (
              <button
                key={floor.key}
                type="button"
                role="tab"
                aria-selected={floor.key === activeFloor?.key}
                onClick={() => {
                  setActiveFloorKey(floor.key);
                  setSelectedTableId(null);
                }}
                className={`min-h-10 shrink-0 rounded-md border px-4 text-sm font-semibold ${floor.key === activeFloor?.key ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-700"}`}
              >
                {floor.name}
              </button>
            ))}
          </div>
          <div className="mb-2 flex items-center justify-between">
            <h2 id="floor-map-heading" className="text-sm font-semibold">{t("dining.selectTable")}</h2>
            <span className="text-xs text-stone-500">{t("dining.tableCount", { count: visibleTables.length })}</span>
          </div>
          <div
            role="region"
            aria-label={t("dining.floorRegion")}
            className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-stone-300 bg-stone-50"
            style={{
              backgroundImage: "linear-gradient(to right, #e7e5e4 1px, transparent 1px), linear-gradient(to bottom, #e7e5e4 1px, transparent 1px)",
              backgroundSize: "10% 10%",
            }}
          >
            {visibleTables.map((table) => {
              const tableOrders = ordersByTable.get(table.id) ?? [];
              const status = !table.isActive && tableOrders.length === 0
                ? { key: "INACTIVE" as const, unservedCount: 0 }
                : getTableStatus(table, tableOrders);
              const statusLabel = tableStatusLabel(status.key, t);
              const selected = selectedTableId === table.id;
              return (
                <button
                  key={table.id}
                  type="button"
                  aria-label={t("dining.tableAria", { table: table.label, status: statusLabel, unserved: status.unservedCount > 0 ? t("dining.unservedAria", { count: status.unservedCount }) : "" })}
                  aria-pressed={selected}
                  onClick={() => setSelectedTableId(table.id)}
                  className={`absolute flex h-[16%] w-[18%] flex-col items-center justify-center overflow-hidden rounded-md border px-1 text-center shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal-600 ${tableStatusStyles[status.key]} ${selected ? "ring-2 ring-teal-700 ring-offset-2" : ""}`}
                  style={{ left: `${table.layoutX / 10}%`, top: `${table.layoutY / 10}%` }}
                >
                  <DiningTableShapeGraphic shape={table.shape} rotationDegrees={table.rotationDegrees} className="pointer-events-none absolute inset-0 h-full w-full" />
                  <span className="relative line-clamp-2 text-xs font-bold sm:text-sm">{table.label}</span>
                  <span className="relative mt-0.5 text-[10px] font-semibold sm:text-xs">{statusLabel}</span>
                  {status.unservedCount > 0 ? <span className="relative text-[9px] sm:text-[10px]">{t("dining.unserved", { count: status.unservedCount })}</span> : null}
                  {table.seatedAt && status.key !== "EMPTY" ? <span className="relative hidden text-[9px] sm:block">{t("dining.seatedShort", { time: formatAppDateTime(locale, table.seatedAt, { timeStyle: "short", timeZone: "Asia/Taipei" }) })}</span> : null}
                </button>
              );
            })}
            {visibleTables.length === 0 ? <div className="absolute inset-0 grid place-items-center text-sm text-stone-500">{t("dining.noTables")}</div> : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-600">
            <Legend color="bg-white border-stone-400" label={tableStatusLabel("EMPTY", t)} />
            <Legend color="bg-amber-100 border-amber-500" label={tableStatusLabel("WAITING", t)} />
            <Legend color="bg-orange-100 border-orange-500" label={tableStatusLabel("PREPARING", t)} />
            <Legend color="bg-blue-100 border-blue-600" label={tableStatusLabel("READY", t)} />
            <Legend color="bg-emerald-100 border-emerald-600" label={tableStatusLabel("SERVED", t)} />
            <Legend color="bg-violet-100 border-violet-500" label={tableStatusLabel("OCCUPIED", t)} />
            <Legend color="bg-rose-100 border-rose-500" label={tableStatusLabel("CLEANING", t)} />
            <Legend color="bg-stone-200 border-stone-400" label={tableStatusLabel("INACTIVE", t)} />
          </div>
        </section>

        <section aria-labelledby="table-detail-heading" className="border-y border-stone-200 py-4 lg:sticky lg:top-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-stone-500">{t("dining.details")}</p>
              <h2 id="table-detail-heading" className="mt-1 text-xl font-semibold">{selectedTable?.label ?? t("dining.noneSelected")}</h2>
            </div>
            {selectedTable ? <div className="text-right"><span className="text-xs text-stone-500">{selectedTable.code}</span>{selectedTableStatus ? <div className="mt-1 text-xs font-semibold">{tableStatusLabel(selectedTableStatus.key, t)}</div> : null}</div> : null}
          </div>

          {selectedTable?.seatedAt ? <p className="mt-3 text-xs text-stone-500">{t("dining.seatedAt", { time: formatAppDateTime(locale, selectedTable.seatedAt, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Taipei" }) })}</p> : null}

          {!selectedTable ? <p className="mt-5 text-sm text-stone-500">{t("dining.chooseHint")}</p> : null}
          {selectedTable && selectedOrders.length === 0 ? <div className="mt-5"><p className={`text-sm ${selectedTable.serviceState === "NEEDS_CLEANING" ? "text-rose-700" : "text-emerald-700"}`}>{selectedTable.serviceState === "NEEDS_CLEANING" ? t("dining.emptyCleaning") : selectedTable.serviceState === "OCCUPIED" ? t("dining.emptyOccupied") : t("dining.emptyAvailable")}</p>{selectedTable.serviceState === "NEEDS_CLEANING" ? <button type="button" disabled={busyTableId === selectedTable.id} onClick={() => void updateTableServiceState(selectedTable.id, "EMPTY")} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-800 px-3 text-sm font-semibold text-white disabled:opacity-50"><CircleCheck className="h-4 w-4" />{t("dining.markClean")}</button> : selectedTable.serviceState === "OCCUPIED" ? <button type="button" disabled={busyTableId === selectedTable.id} onClick={() => void updateTableServiceState(selectedTable.id, "NEEDS_CLEANING")} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-rose-400 px-3 text-sm font-semibold text-rose-800 disabled:opacity-50">{t("dining.markNeedsCleaning")}</button> : null}</div> : null}
          {selectedOrders.map((order) => {
            const pendingCount = order.items.filter((item) => item.status === "PENDING").length;
            const preparingCount = order.items.filter((item) => item.status === "PREPARING").length;
            const readyCount = order.items.filter((item) => item.status === "READY").length;
            return (
              <article key={order.id} className="mt-5 border-t border-stone-200 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{t("dining.order", { number: order.orderNo })}</h3>
                    <p className="mt-1 text-xs text-stone-500">{order.customerName} · {formatAppDateTime(locale, order.createdAt, { timeStyle: "short", timeZone: "Asia/Taipei" })}</p>
                  </div>
                  <span className="rounded bg-stone-100 px-2 py-1 text-xs font-semibold">{orderStatusLabel(order.status, t)}</span>
                </div>

                {order.status === "WAITING_CONFIRMATION" && canTransitionOrder(order.status, "CONFIRMED", account.role) ? (
                  <button type="button" disabled={busyOrderId === order.id} onClick={() => void confirmOrder(order.id)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-50">
                    <CircleCheck className="h-4 w-4" />{t("common.confirm")}
                  </button>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {pendingCount > 0 && canTransitionOrderItem("PENDING", "PREPARING", account.role) ? <BulkButton busy={busyOrderId === order.id} label={t("dining.bulkStart", { count: pendingCount })} onClick={() => void updateAllItems(order.id, "PREPARING")} /> : null}
                  {preparingCount > 0 && canTransitionOrderItem("PREPARING", "READY", account.role) ? <BulkButton busy={busyOrderId === order.id} label={t("dining.bulkReady", { count: preparingCount })} onClick={() => void updateAllItems(order.id, "READY")} /> : null}
                  {readyCount > 0 && canTransitionOrderItem("READY", "SERVED", account.role) ? <BulkButton busy={busyOrderId === order.id} label={t("dining.bulkServed", { count: readyCount })} onClick={() => void updateAllItems(order.id, "SERVED")} /> : null}
                </div>

                <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-200">
                  {order.items.map((item) => {
                    const nextStatus = item.status === "PENDING" ? "PREPARING" : item.status === "PREPARING" ? "READY" : item.status === "READY" ? "SERVED" : null;
                    const canUpdate = nextStatus && canTransitionOrderItem(item.status, nextStatus, account.role);
                    return (
                      <li key={item.id} className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium">{item.quantity} × {item.name}</p>
                            {item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{item.noteOptions.map((option) => `${option.groupName}: ${option.optionName}`).join(", ")}</p> : null}
                            {item.note ? <p className="mt-1 text-xs text-stone-500">{t("dining.note", { note: item.note })}</p> : null}
                          </div>
                          <span className={`shrink-0 text-xs font-semibold ${item.status === "SERVED" ? "text-emerald-700" : item.status === "READY" ? "text-blue-700" : "text-amber-700"}`}>{item.status === "SERVED" ? t("staff.item.served") : t("dining.itemUnserved", { status: orderItemStatusLabel(item.status, t) })}</span>
                        </div>
                        {canUpdate && nextStatus ? (
                          <button type="button" disabled={busyItemId === item.id || busyOrderId === order.id} onClick={() => void updateItemStatus(order.id, item.id, nextStatus)} className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-50">
                            {busyItemId === item.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : nextStatus === "SERVED" ? <Utensils className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                            {nextStatus === "PREPARING" ? t("offline.recovery.startPreparing") : nextStatus === "READY" ? t("offline.recovery.foodReady") : t("dining.markServed")}
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

type OperationsTranslator = ReturnType<typeof useOperationsLocale>["t"];

function tableStatusLabel(status: keyof typeof tableStatusStyles, t: OperationsTranslator) {
  switch (status) {
    case "EMPTY": return t("dining.status.empty");
    case "WAITING": return t("staff.status.waiting");
    case "PREPARING": return t("staff.status.preparing");
    case "READY": return t("staff.status.awaitingService");
    case "SERVED": return t("staff.item.served");
    case "OCCUPIED": return t("dining.status.occupied");
    case "CLEANING": return t("dining.status.cleaning");
    case "INACTIVE": return t("dining.status.inactive");
  }
}

function orderItemStatusLabel(status: OrderItemStatus, t: OperationsTranslator) {
  return t(status === "PENDING"
    ? "staff.item.pending"
    : status === "PREPARING"
      ? "staff.item.preparing"
      : status === "READY"
        ? "staff.item.ready"
        : status === "SERVED"
          ? "staff.item.served"
          : "staff.item.cancelled");
}

function orderStatusLabel(status: OrderStatus, t: OperationsTranslator) {
  return t(status === "WAITING_CONFIRMATION"
    ? "staff.status.waiting"
    : status === "CONFIRMED"
      ? "staff.status.confirmed"
      : status === "PREPARING"
        ? "staff.status.preparing"
        : status === "PACKING"
          ? "staff.status.packing"
          : status === "READY"
            ? "staff.status.awaitingService"
            : status === "COMPLETED"
              ? "staff.status.completed"
              : status === "CANCELLED"
                ? "staff.status.cancelled"
                : "staff.status.expired");
}

function roleLabel(role: UserRole, t: OperationsTranslator) {
  return t(role === "ORGANIZATION_OWNER" || role === "MERCHANT_OWNER"
    ? "staff.role.owner"
    : role === "STALL_MANAGER" || role === "MERCHANT_MANAGER"
      ? "staff.role.manager"
      : role === "KITCHEN"
        ? "staff.role.kitchen"
        : role === "FINANCE_VIEWER"
          ? "staff.role.finance"
          : role === "STAFF"
            ? "staff.role.staff"
            : "staff.role.admin");
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded-sm border ${color}`} />{label}</span>;
}

function BulkButton({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-teal-700 px-3 text-xs font-semibold text-teal-900 disabled:opacity-50">
      <CheckCheck className="h-3.5 w-3.5" />{label}
    </button>
  );
}
