"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrderStatus, UserRole } from "@prisma/client";
import { CheckCircle2, LoaderCircle, RefreshCw, TriangleAlert, Wifi, WifiOff } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";
import { orderStatusLabels, paymentStatusLabels, staffStatusOptions } from "@/lib/orders";
import { isCompletePickupCode, normalizePickupCode } from "@/lib/pickup-code";
import { canTransitionOrder, hasPermission, roleLabels } from "@/lib/rbac";
import { createOptionalSupabaseBrowserClient } from "@/lib/supabase-browser";

type OrderWithItems = {
  id: string;
  orderNo: string;
  source: string;
  customerName: string;
  tableLabel: string | null;
  note: string | null;
  status: OrderStatus;
  paymentStatus: keyof typeof paymentStatusLabels;
  total: number;
  pickupVerifiedAt: string | null;
  confirmationExpiresAt: string;
  createdAt: string;
  items: Array<{ id: string; name: string; unitPrice: number; quantity: number }>;
};

type Props = {
  stall: { id: string; slug: string; name: string; currency: string };
  initialOrders: OrderWithItems[];
  account: { displayName: string; role: UserRole };
};

type StaffStatus = (typeof staffStatusOptions)[number]["value"];
type LiveConnectionState = "connecting" | "connected" | "fallback";
type PendingCancellation = Pick<OrderWithItems, "id" | "orderNo" | "customerName">;

export function StaffOrderBoard({ stall, initialOrders, account }: Props) {
  const [orders, setOrders] = useState(initialOrders);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [verifyingPickupOrderId, setVerifyingPickupOrderId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>("connecting");
  const [pendingCancellation, setPendingCancellation] = useState<PendingCancellation | null>(null);
  const [message, setMessage] = useState("");

  const refreshOrders = useCallback(async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true);
      setMessage("");
    }
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新訂單。");
      const nextOrders: OrderWithItems[] = payload.orders ?? [];
      setOrders(nextOrders);
      setPendingCancellation((current) => (
        current && !nextOrders.some((order) => order.id === current.id) ? null : current
      ));
    } catch (error) {
      if (!silent) {
        setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      }
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, [stall.slug]);

  async function updateOrder(
    orderId: string,
    status: StaffStatus,
    confirmationOrderNo?: string,
  ) {
    setMessage("");
    setUpdatingOrderId(orderId);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          status,
          ...(status === "CANCELLED" ? { confirmationOrderNo } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新訂單。");
      setOrders((current) =>
        status === "COMPLETED" || status === "CANCELLED"
          ? current.filter((order) => order.id !== orderId)
          : current.map((order) => (order.id === orderId ? payload.order : order)),
      );
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      return false;
    } finally {
      setUpdatingOrderId(null);
    }
  }

  async function confirmCancellation() {
    if (!pendingCancellation) return;
    const cancelled = await updateOrder(
      pendingCancellation.id,
      "CANCELLED",
      pendingCancellation.orderNo,
    );
    if (cancelled) setPendingCancellation(null);
  }

  async function verifyPickup(orderId: string, code: string) {
    if (!isCompletePickupCode(code) || verifyingPickupOrderId === orderId) return;
    setMessage("");
    setVerifyingPickupOrderId(orderId);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}/verify-pickup`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ code }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "取餐碼驗證失敗。");
      setOrders((current) => current.map((order) => (
        order.id === orderId ? { ...order, pickupVerifiedAt: payload.pickupVerifiedAt } : order
      )));
      setPickupCodes((current) => ({ ...current, [orderId]: "" }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      setPickupCodes((current) => ({ ...current, [orderId]: "" }));
    } finally {
      setVerifyingPickupOrderId(null);
    }
  }

  function handlePickupCodeChange(orderId: string, value: string) {
    const code = normalizePickupCode(value);
    setMessage("");
    setPickupCodes((current) => ({ ...current, [orderId]: code }));
    if (isCompletePickupCode(code)) void verifyPickup(orderId, code);
  }

  useEffect(() => {
    let eventSource: EventSource | null = null;
    const supabase = createOptionalSupabaseBrowserClient();
    let realtimeConnected = false;
    let sseConnected = false;
    let fallbackTimer: number | null = null;
    let fallbackStatusTimer: number | null = null;

    const refreshSilently = () => void refreshOrders(true);
    const stopFallback = () => {
      if (fallbackTimer !== null) {
        window.clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      if (fallbackStatusTimer !== null) {
        window.clearTimeout(fallbackStatusTimer);
        fallbackStatusTimer = null;
      }
    };
    const startFallback = () => {
      if (fallbackTimer === null) {
        refreshSilently();
        fallbackTimer = window.setInterval(refreshSilently, 5_000);
      }
      if (fallbackStatusTimer === null) {
        fallbackStatusTimer = window.setTimeout(() => {
          if (!realtimeConnected && !sseConnected) setLiveConnection("fallback");
          fallbackStatusTimer = null;
        }, 4_000);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshSilently();
    };

    if ("EventSource" in window) {
      eventSource = new EventSource(`/api/stalls/${stall.slug}/orders/stream`);
      eventSource.onopen = () => {
        sseConnected = true;
        stopFallback();
        setLiveConnection("connected");
        refreshSilently();
      };
      eventSource.addEventListener("orders", refreshSilently);
      eventSource.onerror = () => {
        sseConnected = false;
        if (!realtimeConnected) startFallback();
      };
    } else {
      startFallback();
    }

    const realtimeChannel = supabase
      ?.channel(`stall:${stall.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "operational_events",
          filter: `stall_id=eq.${stall.id}`,
        },
        refreshSilently,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeConnected = true;
          stopFallback();
          setLiveConnection("connected");
          refreshSilently();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeConnected = false;
          if (!sseConnected) startFallback();
        }
      });

    const safetyTimer = window.setInterval(refreshSilently, 30_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      eventSource?.close();
      if (supabase && realtimeChannel) void supabase.removeChannel(realtimeChannel);
      stopFallback();
      window.clearInterval(safetyTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshOrders, stall.id, stall.slug]);

  useEffect(() => {
    if (!pendingCancellation) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && updatingOrderId !== pendingCancellation.id) {
        setPendingCancellation(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingCancellation, updatingOrderId]);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-5 md:px-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-800">行動訂單看板</p>
          <h1 className="text-3xl font-semibold">{stall.name}</h1>
          <p className="mt-1 text-xs text-stone-500">{account.displayName} · {roleLabels[account.role]}</p>
        </div>
        <div className="flex gap-2">
          <span
            className={`inline-flex h-10 items-center gap-1.5 text-xs font-medium ${liveConnection === "connected" ? "text-emerald-700" : "text-amber-700"}`}
            title={liveConnection === "connected" ? "即時更新已連線" : "即時連線中斷，已啟用自動更新備援"}
          >
            {liveConnection === "connected" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            <span className="hidden sm:inline">{liveConnection === "connected" ? "即時更新中" : "自動更新中"}</span>
          </span>
          <button type="button" onClick={() => void refreshOrders()} title="重新整理" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="sr-only">重新整理</span>
          </button>
          <LogoutButton />
        </div>
      </div>
      {message ? <p role="alert" className="mt-4 text-sm text-red-700">{message}</p> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {orders.map((order) => (
          <article key={order.id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-stone-500">訂單 {order.orderNo}</div>
                <h2 className="mt-1 font-semibold">{order.customerName}</h2>
                <p className="mt-1 text-sm text-stone-500">
                  {order.tableLabel || "現場取餐"} · {new Date(order.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">{orderStatusLabels[order.status]}</span>
            </div>
            {order.status === "WAITING_CONFIRMATION" ? (
              <p className="mt-3 text-xs font-medium text-amber-800">確認後才可開始製作；逾時時間 {new Date(order.confirmationExpiresAt).toLocaleTimeString("zh-TW")}</p>
            ) : null}
            <ul className="mt-4 space-y-2 text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3">
                  <span>{item.quantity} × {item.name}</span>
                  <span>{formatMoney(item.unitPrice * item.quantity, stall.currency)}</span>
                </li>
              ))}
            </ul>
            {order.note ? <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{order.note}</p> : null}
            <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-4">
              <strong>{formatMoney(order.total, stall.currency)}</strong>
              <span className="text-sm text-stone-600">{paymentStatusLabels[order.paymentStatus]}</span>
            </div>

            {order.status === "READY" && order.source === "QR_MENU" && hasPermission(account.role, "CHECKOUT_ORDERS") ? (
              order.pickupVerifiedAt ? (
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-teal-800">
                  <CheckCircle2 className="h-4 w-4" />取餐碼已驗證
                </div>
              ) : (
                <div className="relative mt-4">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label="六位數取餐碼"
                    aria-busy={verifyingPickupOrderId === order.id}
                    disabled={verifyingPickupOrderId === order.id}
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={pickupCodes[order.id] ?? ""}
                    onChange={(event) => handlePickupCodeChange(order.id, event.target.value)}
                    className="h-11 w-full rounded-md border border-stone-300 px-3 pr-11 font-mono text-lg disabled:bg-stone-50"
                    placeholder="六位取餐碼"
                  />
                  {verifyingPickupOrderId === order.id ? (
                    <span className="absolute inset-y-0 right-3 grid place-items-center text-teal-700" role="status">
                      <LoaderCircle className="h-5 w-5 animate-spin" />
                      <span className="sr-only">正在驗證取餐碼</span>
                    </span>
                  ) : null}
                </div>
              )
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
              {staffStatusOptions
                .filter((option) => canTransitionOrder(order.status, option.value, account.role))
                .filter((option) => option.value !== "COMPLETED" || order.source !== "QR_MENU" || Boolean(order.pickupVerifiedAt))
                .map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={updatingOrderId === order.id}
                    aria-haspopup={option.value === "CANCELLED" ? "dialog" : undefined}
                    onClick={() => {
                      if (option.value === "CANCELLED") {
                        setPendingCancellation({
                          id: order.id,
                          orderNo: order.orderNo,
                          customerName: order.customerName,
                        });
                        return;
                      }
                      void updateOrder(order.id, option.value);
                    }}
                    className={`rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${option.value === "CANCELLED" ? "border-red-300 text-red-700 hover:bg-red-50" : "border-stone-300 hover:bg-stone-100"}`}
                  >
                    {option.label}
                  </button>
                ))}
            </div>
          </article>
        ))}
      </div>
      {orders.length === 0 ? <p className="mt-10 text-center text-sm text-stone-500">目前沒有待處理訂單。</p> : null}

      {pendingCancellation ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-order-title"
            aria-describedby="cancel-order-description"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-700">
                <TriangleAlert className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 id="cancel-order-title" className="text-lg font-semibold">確認取消訂單？</h2>
                <p className="mt-1 break-words text-sm font-medium text-stone-800">
                  訂單 {pendingCancellation.orderNo} · {pendingCancellation.customerName}
                </p>
              </div>
            </div>
            <p id="cancel-order-description" className="mt-4 text-sm leading-6 text-stone-600">
              取消後無法恢復。請先確認尚未開始製作，或已經與顧客完成溝通。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                autoFocus
                disabled={updatingOrderId === pendingCancellation.id}
                onClick={() => setPendingCancellation(null)}
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50"
              >
                返回訂單
              </button>
              <button
                type="button"
                disabled={updatingOrderId === pendingCancellation.id}
                onClick={() => void confirmCancellation()}
                className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updatingOrderId === pendingCancellation.id ? "取消處理中…" : "確認取消訂單"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
