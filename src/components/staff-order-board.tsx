"use client";

import { useCallback, useEffect, useState } from "react";
import type { FulfillmentType, OrderItemStatus, OrderStatus, PaymentOptionKind, UserRole } from "@prisma/client";
import { CheckCircle2, LoaderCircle, Printer, RefreshCw, TriangleAlert, Wifi, WifiOff, X } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";
import { canTransitionOrderItem } from "@/lib/order-item-status";
import { orderItemStatusLabels, orderStatusLabels, paymentStatusLabels, staffStatusOptions } from "@/lib/orders";
import { isCompletePickupCode, normalizePickupCode } from "@/lib/pickup-code";
import { canTransitionOrder, hasPermission, roleLabels } from "@/lib/rbac";
import { createOptionalSupabaseBrowserClient } from "@/lib/supabase-browser";

type OrderWithItems = {
  id: string;
  orderNo: string;
  source: string;
  customerName: string;
  tableLabel: string | null;
  fulfillmentType: FulfillmentType;
  note: string | null;
  status: OrderStatus;
  paymentStatus: keyof typeof paymentStatusLabels;
  subtotal: number;
  discountAmount: number;
  discountLabel: string | null;
  total: number;
  pickupVerifiedAt: string | null;
  confirmationExpiresAt: string;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    unitPrice: number;
    quantity: number;
    note: string | null;
    noteOptions: Array<{ groupName: string; optionName: string; priceDelta: number }>;
    status: OrderItemStatus;
    preparingAt: string | null;
    readyAt: string | null;
    servedAt: string | null;
  }>;
};

type Props = {
  stall: { id: string; slug: string; name: string; currency: string };
  initialOrders: OrderWithItems[];
  account: { displayName: string; role: UserRole };
  modules: { print: boolean; payment: boolean; discount: boolean };
  paymentOptions: Array<{ id: string; name: string; kind: PaymentOptionKind }>;
  discountOptions: Array<{ id: string; name: string; rateBps: number }>;
};

type StaffStatus = (typeof staffStatusOptions)[number]["value"];
type LiveConnectionState = "connecting" | "connected" | "fallback";
type PendingCancellation = Pick<OrderWithItems, "id" | "orderNo" | "customerName">;
type CheckoutRequest = {
  paymentOptionId: string | null;
  discountOptionId: string | null;
  cashReceived: number | null;
};

export function StaffOrderBoard({ stall, initialOrders, account, modules, paymentOptions, discountOptions }: Props) {
  const [orders, setOrders] = useState(initialOrders);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [verifyingPickupOrderId, setVerifyingPickupOrderId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>("connecting");
  const [pendingCancellation, setPendingCancellation] = useState<PendingCancellation | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<OrderWithItems | null>(null);
  const [selectedPaymentOptionId, setSelectedPaymentOptionId] = useState<string | null>(null);
  const [selectedDiscountOptionId, setSelectedDiscountOptionId] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
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
      setCheckoutOrder((current) => (
        current ? nextOrders.find((order) => order.id === current.id) ?? null : null
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
    options: { confirmationOrderNo?: string; checkout?: CheckoutRequest } = {},
  ) {
    setMessage("");
    setUpdatingOrderId(orderId);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          status,
          ...(status === "CANCELLED" ? { confirmationOrderNo: options.confirmationOrderNo } : {}),
          ...(status === "COMPLETED" ? options.checkout : {}),
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
      { confirmationOrderNo: pendingCancellation.orderNo },
    );
    if (cancelled) setPendingCancellation(null);
  }

  async function updateItemStatus(
    orderId: string,
    itemId: string,
    status: Exclude<OrderItemStatus, "PENDING">,
  ) {
    setMessage("");
    setUpdatingItemId(itemId);
    try {
      const response = await fetch(
        `/api/stalls/${stall.slug}/orders/${orderId}/items/${itemId}`,
        {
          method: "PATCH",
          headers: csrfHeaders(),
          body: JSON.stringify({ status }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新餐點狀態。");
      setOrders((current) => current.map((order) => (
        order.id === orderId ? payload.order : order
      )));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setUpdatingItemId(null);
    }
  }

  function openCheckout(order: OrderWithItems) {
    const defaultPayment = modules.payment
      ? paymentOptions[0] ?? null
      : paymentOptions.find((option) => option.kind === "CASH") ?? null;
    setCheckoutOrder(order);
    setSelectedPaymentOptionId(defaultPayment?.id ?? null);
    setSelectedDiscountOptionId(null);
    setCashReceived("");
    setMessage("");
  }

  async function completeCheckout() {
    if (!checkoutOrder) return;
    const paymentOption = modules.payment
      ? paymentOptions.find((option) => option.id === selectedPaymentOptionId) ?? null
      : paymentOptions.find((option) => option.kind === "CASH") ?? null;
    const isCash = !modules.payment || paymentOption?.kind === "CASH";
    const received = isCash && cashReceived !== "" ? Number(cashReceived) : null;
    const completed = await updateOrder(checkoutOrder.id, "COMPLETED", {
      checkout: {
        paymentOptionId: modules.payment ? selectedPaymentOptionId : null,
        discountOptionId: modules.discount ? selectedDiscountOptionId : null,
        cashReceived: received,
      },
    });
    if (completed) setCheckoutOrder(null);
  }

  function printOrder(orderId: string) {
    setPrintingOrderId(orderId);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
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

  useEffect(() => {
    const resetPrintState = () => setPrintingOrderId(null);
    window.addEventListener("afterprint", resetPrintState);
    return () => window.removeEventListener("afterprint", resetPrintState);
  }, []);

  useEffect(() => {
    if (!checkoutOrder) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && updatingOrderId !== checkoutOrder.id) setCheckoutOrder(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkoutOrder, updatingOrderId]);

  const checkoutDiscount = discountOptions.find((option) => option.id === selectedDiscountOptionId) ?? null;
  const checkoutTotal = checkoutOrder
    ? Math.round((checkoutOrder.subtotal * (checkoutDiscount?.rateBps ?? 10_000)) / 10_000)
    : 0;
  const checkoutPayment = paymentOptions.find((option) => option.id === selectedPaymentOptionId) ?? null;
  const checkoutUsesCash = !modules.payment || checkoutPayment?.kind === "CASH";
  const parsedCashReceived = cashReceived === "" ? checkoutTotal : Number(cashReceived);
  const checkoutChange = checkoutUsesCash && Number.isFinite(parsedCashReceived)
    ? Math.max(0, parsedCashReceived - checkoutTotal)
    : 0;
  const checkoutReady = Boolean(
    checkoutOrder
    && (!modules.payment || checkoutPayment)
    && (!checkoutUsesCash || (Number.isInteger(parsedCashReceived) && parsedCashReceived >= checkoutTotal)),
  );

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-5 md:px-8">
      <div className="flex items-center justify-between gap-4 print:hidden">
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
      {message ? <p role="alert" className="mt-4 text-sm text-red-700 print:hidden">{message}</p> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 print:block">
        {orders.map((order) => (
          <article
            key={order.id}
            className={`rounded-lg border border-stone-200 bg-white p-4 print:border-0 print:p-0 ${printingOrderId && printingOrderId !== order.id ? "print:hidden" : ""}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-stone-500">訂單 {order.orderNo}</div>
                <h2 className="mt-1 font-semibold">{order.customerName}</h2>
                <p className="mt-1 text-sm text-stone-500">
                  {order.fulfillmentType === "DINE_IN" ? `內用 · ${order.tableLabel ?? "未指定桌位"}` : "外帶取餐"} · {new Date(order.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">{orderStatusLabels[order.status]}</span>
            </div>
            {order.status === "WAITING_CONFIRMATION" ? (
              <p className="mt-3 text-xs font-medium text-amber-800">確認後才可開始製作；逾時時間 {new Date(order.confirmationExpiresAt).toLocaleTimeString("zh-TW")}</p>
            ) : null}
            <ul className="mt-4 divide-y divide-stone-100 border-y border-stone-200 text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{item.quantity} × {item.name}</span>
                      <span>{formatMoney(item.unitPrice * item.quantity, stall.currency)}</span>
                    </div>
                    {item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{item.noteOptions.map((noteOption) => `${noteOption.groupName}：${noteOption.optionName}${noteOption.priceDelta === 0 ? "" : ` (${noteOption.priceDelta > 0 ? "+" : ""}${formatMoney(noteOption.priceDelta, stall.currency)})`}`).join("、")}</p> : null}
                    {item.note ? <p className="mt-1 text-xs text-stone-600">備註：{item.note}</p> : null}
                    <span className={`mt-1 inline-flex rounded px-2 py-0.5 text-xs font-semibold ${item.status === "SERVED" ? "bg-emerald-50 text-emerald-800" : item.status === "READY" ? "bg-blue-50 text-blue-800" : item.status === "PREPARING" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>
                      {orderItemStatusLabels[item.status]}
                    </span>
                  </div>
                  {item.status !== "SERVED" && order.status !== "WAITING_CONFIRMATION" ? (
                    <ItemStatusButton
                      itemStatus={item.status}
                      role={account.role}
                      busy={updatingItemId === item.id}
                      onUpdate={(status) => void updateItemStatus(order.id, item.id, status)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            {order.note ? <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{order.note}</p> : null}
            <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-4">
              <div>
                {order.discountAmount > 0 ? <div className="text-xs text-stone-500">原價 {formatMoney(order.subtotal, stall.currency)} · {order.discountLabel}</div> : null}
                <strong>{formatMoney(order.total, stall.currency)}</strong>
              </div>
              <span className="text-sm text-stone-600">{paymentStatusLabels[order.paymentStatus]}</span>
            </div>

            {modules.print ? (
              <button
                type="button"
                onClick={() => printOrder(order.id)}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-medium hover:bg-stone-100 print:hidden"
              >
                <Printer className="h-4 w-4" />列印訂單
              </button>
            ) : null}

            {order.status === "READY" && order.fulfillmentType === "TAKEOUT" && order.source === "QR_MENU" && hasPermission(account.role, "CHECKOUT_ORDERS") ? (
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

            <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">
              {staffStatusOptions
                .filter((option) => canTransitionOrder(order.status, option.value, account.role))
                .filter((option) => option.value !== "PREPARING" && option.value !== "READY")
                .filter((option) => option.value !== "COMPLETED" || order.fulfillmentType === "DINE_IN" || order.source !== "QR_MENU" || Boolean(order.pickupVerifiedAt))
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
                      if (option.value === "COMPLETED") {
                        openCheckout(order);
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
      {orders.length === 0 ? <p className="mt-10 text-center text-sm text-stone-500 print:hidden">目前沒有待處理訂單。</p> : null}

      {checkoutOrder ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4 print:hidden">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="checkout-title" className="text-lg font-semibold">完成訂單</h2>
                <p className="mt-1 text-sm text-stone-600">
                  訂單 {checkoutOrder.orderNo} · {checkoutOrder.fulfillmentType === "DINE_IN" ? checkoutOrder.tableLabel : checkoutOrder.customerName}
                </p>
              </div>
              <button
                type="button"
                title="關閉結帳視窗"
                disabled={updatingOrderId === checkoutOrder.id}
                onClick={() => setCheckoutOrder(null)}
                className="grid h-9 w-9 place-items-center rounded-md border border-stone-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5">
              <h3 className="text-xs font-semibold text-stone-600">付款方式</h3>
              {modules.payment ? (
                paymentOptions.length > 0 ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {paymentOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selectedPaymentOptionId === option.id}
                        onClick={() => {
                          setSelectedPaymentOptionId(option.id);
                          setCashReceived("");
                        }}
                        className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold ${selectedPaymentOptionId === option.id ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300"}`}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                ) : <p className="mt-2 text-sm text-red-700">尚未設定可用付款方式，請先至攤位設定新增。</p>
              ) : (
                <div className="mt-2 rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-semibold">現金</div>
              )}
            </div>

            {modules.discount ? (
              <div className="mt-5">
                <h3 className="text-xs font-semibold text-stone-600">折扣</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={selectedDiscountOptionId === null}
                    onClick={() => setSelectedDiscountOptionId(null)}
                    className={`h-10 rounded-md border px-3 text-sm font-medium ${selectedDiscountOptionId === null ? "border-teal-700 bg-teal-50" : "border-stone-300"}`}
                  >
                    無折扣
                  </button>
                  {discountOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selectedDiscountOptionId === option.id}
                      onClick={() => setSelectedDiscountOptionId(option.id)}
                      className={`h-10 rounded-md border px-3 text-sm font-medium ${selectedDiscountOptionId === option.id ? "border-teal-700 bg-teal-50" : "border-stone-300"}`}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <dl className="mt-5 space-y-2 border-y border-stone-200 py-4 text-sm">
              <div className="flex justify-between"><dt>商品小計</dt><dd>{formatMoney(checkoutOrder.subtotal, stall.currency)}</dd></div>
              {checkoutDiscount ? <div className="flex justify-between text-emerald-800"><dt>{checkoutDiscount.name}</dt><dd>-{formatMoney(checkoutOrder.subtotal - checkoutTotal, stall.currency)}</dd></div> : null}
              <div className="flex justify-between text-lg font-semibold"><dt>應收金額</dt><dd>{formatMoney(checkoutTotal, stall.currency)}</dd></div>
            </dl>

            {checkoutUsesCash ? (
              <div className="mt-5">
                <label className="text-xs font-semibold text-stone-600" htmlFor="cash-received">客戶實收金額</label>
                <input
                  id="cash-received"
                  inputMode="numeric"
                  value={cashReceived}
                  onChange={(event) => setCashReceived(event.target.value.replace(/\D/g, "").slice(0, 9))}
                  placeholder={String(checkoutTotal)}
                  className="mt-2 h-11 w-full rounded-md border border-stone-300 px-3 text-lg font-semibold"
                />
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {[checkoutTotal, 200, 500, 1000].filter((value, index, values) => values.indexOf(value) === index).map((value, index) => (
                    <button
                      key={value}
                      type="button"
                      disabled={value < checkoutTotal}
                      onClick={() => setCashReceived(String(value))}
                      className="h-10 rounded-md border border-stone-300 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {index === 0 ? "剛好" : formatMoney(value, stall.currency)}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-between rounded-md bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900">
                  <span>找零</span><span>{formatMoney(checkoutChange, stall.currency)}</span>
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={updatingOrderId === checkoutOrder.id}
                onClick={() => setCheckoutOrder(null)}
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium"
              >
                返回
              </button>
              <button
                type="button"
                disabled={!checkoutReady || updatingOrderId === checkoutOrder.id}
                onClick={() => void completeCheckout()}
                className="rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updatingOrderId === checkoutOrder.id ? "處理中…" : "完成訂單"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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

function ItemStatusButton({
  itemStatus,
  role,
  busy,
  onUpdate,
}: {
  itemStatus: OrderItemStatus;
  role: UserRole;
  busy: boolean;
  onUpdate: (status: Exclude<OrderItemStatus, "PENDING">) => void;
}) {
  const nextStatus = itemStatus === "PENDING"
    ? "PREPARING"
    : itemStatus === "PREPARING"
      ? "READY"
      : itemStatus === "READY"
        ? "SERVED"
        : null;
  if (!nextStatus || !canTransitionOrderItem(itemStatus, nextStatus, role)) return null;

  const labels = {
    PREPARING: "開始製作",
    READY: "餐點完成",
    SERVED: "標記已出餐",
  } as const;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onUpdate(nextStatus)}
      className="min-h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
    >
      {busy ? "更新中…" : labels[nextStatus]}
    </button>
  );
}
