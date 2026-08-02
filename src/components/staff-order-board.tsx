"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CancellationReason, OrderItemStatus, OrderStatus, PaymentOptionKind, UserRole } from "@prisma/client";
import Link from "next/link";
import { CheckCheck, CheckCircle2, ChefHat, KeyRound, ListChecks, LoaderCircle, MapPinned, PackageCheck, Play, Printer, RefreshCw, Search, ShoppingCart, TriangleAlert, Truck, Undo2, Volume2, VolumeX, WalletCards, Wifi, WifiOff, X } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { OfflineBootstrapControl } from "@/components/offline-bootstrap-control";
import { OfflineQueueStatus } from "@/components/offline-queue-status";
import { PwaControls } from "@/components/pwa-controls";
import { StaffOrderComposer } from "@/components/staff-order-composer";
import { StaffDiscountSelector } from "@/components/staff-discount-selector";
import { StaffCapacityControl } from "@/components/staff-capacity-control";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import type { StaffCapacityData } from "@/lib/capacity-contract";
import { cancellationReasonOptions } from "@/lib/cancellation-reasons";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";
import { canTransitionOrderItem } from "@/lib/order-item-status";
import { orderItemStatusLabels, orderStatusLabels, paymentStatusLabels, staffStatusOptions, type StaffOrderDto } from "@/lib/orders";
import { isCompletePickupCode, normalizePickupCode } from "@/lib/pickup-code";
import { canTransitionOrder, hasPermission, roleLabels } from "@/lib/rbac";
import { getStaffCheckoutPreview } from "@/lib/staff-discount-presentation";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";
import type { WorkModeDestination } from "@/lib/work-mode";

type OrderWithItems = StaffOrderDto;

type Props = {
  stall: { id: string; organizationId: string; slug: string; name: string; currency: string };
  initialOrders: OrderWithItems[];
  initialNow: number;
  account: { displayName: string; role: UserRole };
  modules: { dineIn: boolean; delivery: boolean; print: boolean; payment: boolean; discount: boolean; discountApprovalThresholdBps: number };
  paymentOptions: Array<{ id: string; name: string; kind: PaymentOptionKind }>;
  discountOptions: Array<{ id: string; name: string; rateBps: number }>;
  orderCatalog: StaffOrderCatalog | null;
  capacity: StaffCapacityData | null;
  workModeDestinations: WorkModeDestination[];
  appVersion: string;
};

type StaffStatus = (typeof staffStatusOptions)[number]["value"];
type LiveConnectionState = "connecting" | "sse" | "realtime" | "polling";
type PendingCancellation = Pick<OrderWithItems, "id" | "orderNo" | "customerName"> & {
  reason: CancellationReason;
  detail: string;
};
type ManualPickupReason = "DEVICE_LOST" | "TRACKING_UNAVAILABLE" | "OTHER";
type PendingManualPickup = {
  orderId: string;
  reason: ManualPickupReason;
  confirmedCustomerDetails: boolean;
};
type CheckoutRequest = {
  paymentOptionId: string | null;
  discountOptionId: string | null;
  cashReceived: number | null;
  discountApprovalReason: string | null;
  managerEmail: string | null;
  managerPassword: string | null;
};
type UndoBatch = { actionId: string; undoExpiresAt: string; itemCount: number };

export function StaffOrderBoard({
  stall,
  initialOrders,
  initialNow,
  account,
  modules: initialModules,
  paymentOptions: initialPaymentOptions,
  discountOptions: initialDiscountOptions,
  orderCatalog: initialOrderCatalog,
  capacity,
  workModeDestinations,
  appVersion,
}: Props) {
  const knownOrderIdsRef = useRef(new Set(initialOrders.map((order) => order.id)));
  const alertsEnabledRef = useRef(false);
  const [orders, setOrders] = useState(initialOrders);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [verifyingPickupOrderId, setVerifyingPickupOrderId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [updatingItemsOrderId, setUpdatingItemsOrderId] = useState<string | null>(null);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>("connecting");
  const [pendingCancellation, setPendingCancellation] = useState<PendingCancellation | null>(null);
  const [pendingManualPickup, setPendingManualPickup] = useState<PendingManualPickup | null>(null);
  const [checkoutOrders, setCheckoutOrders] = useState<OrderWithItems[]>([]);
  const [selectedPaymentOptionId, setSelectedPaymentOptionId] = useState<string | null>(null);
  const [selectedDiscountOptionId, setSelectedDiscountOptionId] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [discountApprovalReason, setDiscountApprovalReason] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(initialNow);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<"TICKETS" | "TABLES" | "SUMMARY">("TICKETS");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [undoBatch, setUndoBatch] = useState<UndoBatch | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [modules, setModules] = useState(initialModules);
  const [paymentOptions, setPaymentOptions] = useState(initialPaymentOptions);
  const [discountOptions, setDiscountOptions] = useState(initialDiscountOptions);
  const [orderCatalog, setOrderCatalog] = useState(initialOrderCatalog);
  const [posConfigurationLoading, setPosConfigurationLoading] = useState(false);
  const checkoutOrder = checkoutOrders[0] ?? null;

  type PosConfiguration = {
    modules: Props["modules"];
    paymentOptions: Props["paymentOptions"];
    discountOptions: Props["discountOptions"];
    catalog: StaffOrderCatalog | null;
  };

  async function refreshPosConfiguration(includeCatalog = false) {
    setPosConfigurationLoading(true);
    try {
      const response = await fetch(
        `/api/stalls/${stall.slug}/pos-configuration${includeCatalog ? "?includeCatalog=true" : ""}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as PosConfiguration & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新店員點餐設定。");
      setModules(payload.modules);
      setPaymentOptions(payload.paymentOptions);
      setDiscountOptions(payload.discountOptions);
      if (payload.catalog) setOrderCatalog(payload.catalog);
      return payload;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新店員點餐設定，將使用畫面上的現有設定。");
      return null;
    } finally {
      setPosConfigurationLoading(false);
    }
  }

  const notifyNewOrders = useCallback((count: number) => {
    if (!alertsEnabledRef.current) return;
    if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
    playNotificationTone();
    setMessage(count === 1 ? "收到 1 筆新訂單。" : `收到 ${count} 筆新訂單。`);
  }, []);

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
      const offlineOrders = await loadOfflineStaffOrders(stall.id);
      const mergedOrders = mergeStaffOrders(nextOrders, offlineOrders);
      const newWaitingOrders = mergedOrders.filter((order) => (
        order.status === "WAITING_CONFIRMATION" && !knownOrderIdsRef.current.has(order.id)
      ));
      mergedOrders.forEach((order) => knownOrderIdsRef.current.add(order.id));
      if (newWaitingOrders.length > 0) notifyNewOrders(newWaitingOrders.length);
      setOrders(mergedOrders);
      const availableItemIds = new Set(mergedOrders.flatMap((order) => order.items.map((item) => item.id)));
      setSelectedItemIds((current) => new Set([...current].filter((id) => availableItemIds.has(id))));
      setPendingCancellation((current) => (
        current && !nextOrders.some((order) => order.id === current.id) ? null : current
      ));
      setPendingManualPickup((current) => (
        current && !nextOrders.some((order) => order.id === current.orderId) ? null : current
      ));
      setCheckoutOrders((current) => current
        .map((order) => nextOrders.find((candidate) => candidate.id === order.id))
        .filter((order): order is OrderWithItems => Boolean(order)));
    } catch (error) {
      if (!silent) {
        setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      }
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, [notifyNewOrders, stall.id, stall.slug]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const offlineOrders = await loadOfflineStaffOrders(stall.id);
      if (disposed) return;
      offlineOrders.forEach((order) => knownOrderIdsRef.current.add(order.id));
      setOrders((current) => mergeStaffOrders(
        current.filter((order) => order.source !== "OFFLINE_POS"),
        offlineOrders,
      ));
    };
    const onOfflineDataChanged = () => void load();
    void load();
    window.addEventListener("stallorder:offline-data-changed", onOfflineDataChanged);
    return () => {
      disposed = true;
      window.removeEventListener("stallorder:offline-data-changed", onOfflineDataChanged);
    };
  }, [stall.id]);

  function toggleAlerts() {
    const next = !alertsEnabledRef.current;
    alertsEnabledRef.current = next;
    setAlertsEnabled(next);
    window.localStorage.setItem("stallorder_staff_order_alerts", next ? "enabled" : "disabled");
    if (next) playNotificationTone();
  }

  async function updateOrder(
    orderId: string,
    status: StaffStatus,
    options: { confirmationOrderNo?: string; cancellationReason?: CancellationReason; cancellationDetail?: string | null; checkout?: CheckoutRequest } = {},
  ) {
    setMessage("");
    setUpdatingOrderId(orderId);
    try {
      const currentOrder = orders.find((order) => order.id === orderId);
      if (currentOrder?.source === "OFFLINE_POS") {
        const nextState = status === "COMPLETED"
          ? "LOCAL_COMPLETED"
          : status === "CANCELLED" ? "LOCAL_CANCELLED" : null;
        if (!nextState) throw new Error("此離線訂單狀態只能依序從製作、完成餐點到完成訂單。");
        const [{ transitionOfflineOrder }, { offlineOrderToStaffOrder }] = await Promise.all([
          import("@/offline/offline-operations"),
          import("@/offline/offline-staff-order"),
        ]);
        const updated = await transitionOfflineOrder(
          orderId,
          nextState,
          status === "CANCELLED"
            ? [options.cancellationReason, options.cancellationDetail].filter(Boolean).join("：") || "現場取消"
            : null,
        );
        const staffOrder = offlineOrderToStaffOrder(updated);
        setOrders((current) => (
          status === "COMPLETED" || status === "CANCELLED"
            ? current.filter((order) => order.id !== orderId)
            : current.map((order) => order.id === orderId ? staffOrder : order)
        ));
        setMessage(status === "COMPLETED"
          ? "離線訂單已在本機完成，恢復連線後會同步。"
          : "離線訂單已在本機取消，取消紀錄會在恢復連線後同步。");
        return true;
      }
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          status,
          ...(status === "CANCELLED" ? {
            confirmationOrderNo: options.confirmationOrderNo,
            cancellationReason: options.cancellationReason,
            cancellationDetail: options.cancellationDetail,
          } : {}),
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
      {
        confirmationOrderNo: pendingCancellation.orderNo,
        cancellationReason: pendingCancellation.reason,
        cancellationDetail: pendingCancellation.detail.trim() || null,
      },
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

  async function updateAllItemStatuses(orderId: string, status: "PREPARING" | "READY" | "SERVED") {
    setMessage("");
    setUpdatingItemsOrderId(orderId);
    try {
      const currentOrder = orders.find((order) => order.id === orderId);
      if (currentOrder?.source === "OFFLINE_POS") {
        const nextState = status === "PREPARING"
          ? "LOCAL_PREPARING"
          : status === "READY" ? "LOCAL_READY" : "LOCAL_COMPLETED";
        const [{ transitionOfflineOrder }, { offlineOrderToStaffOrder }] = await Promise.all([
          import("@/offline/offline-operations"),
          import("@/offline/offline-staff-order"),
        ]);
        const updated = await transitionOfflineOrder(orderId, nextState);
        const staffOrder = offlineOrderToStaffOrder(updated);
        setOrders((current) => nextState === "LOCAL_COMPLETED"
          ? current.filter((order) => order.id !== orderId)
          : current.map((order) => order.id === orderId ? staffOrder : order));
        setMessage(nextState === "LOCAL_COMPLETED"
          ? "離線訂單已在本機完成，恢復連線後會同步。"
          : "離線製作狀態已安全儲存在此裝置。");
        return;
      }
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}/items`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法批次更新餐點狀態。");
      setOrders((current) => current.map((order) => (
        order.id === orderId ? payload.order : order
      )));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setUpdatingItemsOrderId(null);
    }
  }

  async function updateSelectedItems(
    itemIds: string[],
    status: "PREPARING" | "READY" | "SERVED",
  ) {
    if (itemIds.length === 0) return;
    setMessage("");
    setBatchBusy(true);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/order-items/batch`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "UPDATE", itemIds, status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法批次更新餐點狀態。");
      replaceOrders(payload.orders as OrderWithItems[]);
      setSelectedItemIds(new Set());
      setUndoBatch({
        actionId: payload.actionId,
        undoExpiresAt: payload.undoExpiresAt,
        itemCount: payload.itemCount,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setBatchBusy(false);
    }
  }

  async function undoSelectedItems() {
    if (!undoBatch) return;
    setBatchBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/order-items/batch`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "UNDO", actionId: undoBatch.actionId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法復原餐點狀態。");
      replaceOrders(payload.orders as OrderWithItems[]);
      setUndoBatch(null);
      setMessage("已復原上一筆批次餐點操作。");
    } catch (error) {
      setUndoBatch(null);
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setBatchBusy(false);
    }
  }

  function replaceOrders(nextOrders: OrderWithItems[]) {
    const replacements = new Map(nextOrders.map((order) => [order.id, order]));
    setOrders((current) => current.map((order) => replacements.get(order.id) ?? order));
  }

  function handleStaffOrderCreated(order: OrderWithItems) {
    knownOrderIdsRef.current.add(order.id);
    setOrders((current) => [...current.filter((candidate) => candidate.id !== order.id), order]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
    setComposerOpen(false);
    setViewMode("TICKETS");
    setMessage(order.source === "OFFLINE_POS"
      ? `離線訂單 ${order.orderNo} 已安全儲存在此裝置，恢復連線後會自動同步。`
      : order.paymentStatus === "PAID"
      ? `訂單 ${order.orderNo} 已建立、完成收款並送入廚房。`
      : `訂單 ${order.orderNo} 已建立並送入廚房，請稍後結帳。`);
  }

  async function openComposer() {
    setMessage("");
    const latest = await refreshPosConfiguration(true);
    if (!latest?.catalog && !orderCatalog) return;
    setComposerOpen(true);
  }

  async function openCheckout(orderOrOrders: OrderWithItems | OrderWithItems[]) {
    setMessage("");
    const latest = await refreshPosConfiguration();
    const activeModules = latest?.modules ?? modules;
    const activePaymentOptions = latest?.paymentOptions ?? paymentOptions;
    const ordersToCheckout = Array.isArray(orderOrOrders) ? orderOrOrders : [orderOrOrders];
    const defaultPayment = activeModules.payment
      ? activePaymentOptions[0] ?? null
      : activePaymentOptions.find((option) => option.kind === "CASH") ?? null;
    setCheckoutOrders(ordersToCheckout);
    setSelectedPaymentOptionId(defaultPayment?.id ?? null);
    setSelectedDiscountOptionId(null);
    setCashReceived("");
    setDiscountApprovalReason("");
    setManagerEmail("");
    setManagerPassword("");
  }

  async function completeCheckout() {
    if (checkoutOrders.length === 0) return;
    const paymentOption = modules.payment
      ? paymentOptions.find((option) => option.id === selectedPaymentOptionId) ?? null
      : paymentOptions.find((option) => option.kind === "CASH") ?? null;
    const isCash = !modules.payment || paymentOption?.kind === "CASH";
    const received = isCash && cashReceived !== "" ? Number(cashReceived) : null;
    const checkoutRequest: CheckoutRequest = {
      paymentOptionId: modules.payment ? selectedPaymentOptionId : null,
      discountOptionId: modules.discount ? selectedDiscountOptionId : null,
      cashReceived: received,
      discountApprovalReason: discountApprovalReason.trim() || null,
      managerEmail: managerEmail.trim() || null,
      managerPassword: managerPassword || null,
    };
    if (checkoutOrders.length === 1) {
      const completed = await updateOrder(checkoutOrders[0].id, "COMPLETED", {
        checkout: checkoutRequest,
      });
      if (completed) setCheckoutOrders([]);
      return;
    }

    const diningTableId = checkoutOrders[0].diningTableId;
    if (!diningTableId || checkoutOrders.some((order) => order.diningTableId !== diningTableId)) {
      setMessage("只能合併結帳同一桌的內用訂單。");
      return;
    }
    setUpdatingOrderId(checkoutOrders[0].id);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/table-checkout`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          diningTableId,
          orderIds: checkoutOrders.map((order) => order.id),
          ...checkoutRequest,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法完成同桌結帳。");
      const completedIds = new Set<string>(payload.orderIds ?? []);
      setOrders((current) => current.filter((order) => !completedIds.has(order.id)));
      setCheckoutOrders([]);
      setMessage(`已合併完成 ${completedIds.size} 筆同桌訂單。`);
    } catch (error) {
      setManagerPassword("");
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setUpdatingOrderId(null);
    }
  }

  async function completePaidOrders(paidOrders: OrderWithItems[]) {
    for (const order of paidOrders) {
      if (order.paymentStatus !== "PAID") continue;
      const completed = await updateOrder(order.id, "COMPLETED");
      if (!completed) return;
    }
  }

  async function printOrder(orderId: string) {
    setMessage("");
    try {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (order?.source === "OFFLINE_POS") {
        const { queueOfflinePrintJob } = await import("@/offline/offline-operations");
        await queueOfflinePrintJob(orderId);
        setMessage("離線訂單已排入本機列印佇列；列印結果會在同步時對帳。");
        return;
      }
      const response = await fetch(`/api/stalls/${stall.slug}/print-jobs`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "QUEUE", orderId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法排入列印工作。");
      setMessage("訂單已排入列印工作佇列。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    }
  }

  async function verifyPickup(orderId: string, code: string) {
    const order = orders.find((candidate) => candidate.id === orderId);
    const codeLength = order?.pickupCodeLength === 6 ? 6 : 3;
    if (!isCompletePickupCode(code, codeLength) || verifyingPickupOrderId === orderId) return;
    setMessage("");
    setVerifyingPickupOrderId(orderId);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}/verify-pickup`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ mode: "CODE", code }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "取餐碼驗證失敗。");
      setOrders((current) => current.map((order) => (
        order.id === orderId ? {
          ...order,
          pickupVerifiedAt: payload.pickupVerifiedAt,
          pickupVerificationMethod: payload.pickupVerificationMethod,
        } : order
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
    const order = orders.find((candidate) => candidate.id === orderId);
    const codeLength = order?.pickupCodeLength === 6 ? 6 : 3;
    const code = normalizePickupCode(value, codeLength);
    setMessage("");
    setPickupCodes((current) => ({ ...current, [orderId]: code }));
    if (isCompletePickupCode(code, codeLength)) void verifyPickup(orderId, code);
  }

  async function verifyManualPickup() {
    if (!pendingManualPickup || verifyingPickupOrderId === pendingManualPickup.orderId) return;
    const order = orders.find((candidate) => candidate.id === pendingManualPickup.orderId);
    if (!order || !pendingManualPickup.confirmedCustomerDetails) return;

    setMessage("");
    setVerifyingPickupOrderId(order.id);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${order.id}/verify-pickup`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          mode: "MANUAL",
          confirmationOrderNo: order.orderNo,
          reason: pendingManualPickup.reason,
          confirmedCustomerDetails: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "人工取餐核對失敗。");
      setOrders((current) => current.map((candidate) => (
        candidate.id === order.id ? {
          ...candidate,
          pickupVerifiedAt: payload.pickupVerifiedAt,
          pickupVerificationMethod: payload.pickupVerificationMethod,
        } : candidate
      )));
      setPendingManualPickup(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
    } finally {
      setVerifyingPickupOrderId(null);
    }
  }

  useEffect(() => {
    const preferenceTimer = window.setTimeout(() => {
      const enabled = window.localStorage.getItem("stallorder_staff_order_alerts") === "enabled";
      alertsEnabledRef.current = enabled;
      setAlertsEnabled(enabled);
    }, 0);
    const ageTimer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(preferenceTimer);
      window.clearInterval(ageTimer);
    };
  }, []);

  useEffect(() => {
    if (!undoBatch) return;
    const delay = Math.max(0, new Date(undoBatch.undoExpiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => setUndoBatch(null), delay);
    return () => window.clearTimeout(timer);
  }, [undoBatch]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let realtimeConnected = false;
    let sseConnected = false;
    let realtimeLoadStarted = false;
    let removeRealtimeChannel: (() => void) | null = null;
    let fallbackTimer: number | null = null;
    let fallbackStatusTimer: number | null = null;
    let disposed = false;

    const refreshSilently = () => void refreshOrders(true);
    const refreshBackendAvailability = () => {
      void fetch("/api/availability/config", { cache: "no-store" }).catch(() => undefined);
    };
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
          if (!realtimeConnected && !sseConnected) setLiveConnection("polling");
          fallbackStatusTimer = null;
        }, 4_000);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshSilently();
    };
    const stopRealtime = () => {
      removeRealtimeChannel?.();
      removeRealtimeChannel = null;
      realtimeConnected = false;
      realtimeLoadStarted = false;
    };
    const startRealtimeFallback = async () => {
      if (disposed || sseConnected || realtimeLoadStarted) return;
      realtimeLoadStarted = true;
      try {
        const { createOptionalSupabaseBrowserClient } = await import("@/lib/supabase-browser");
        if (disposed || sseConnected) return;
        const supabase = createOptionalSupabaseBrowserClient();
        if (!supabase) return;
        const channel = supabase
          .channel(`stall:${stall.id}`)
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
              setLiveConnection("realtime");
              refreshBackendAvailability();
              refreshSilently();
            }
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              realtimeConnected = false;
              if (!sseConnected) startFallback();
            }
          });
        removeRealtimeChannel = () => void supabase.removeChannel(channel);
      } catch {
        realtimeLoadStarted = false;
        if (!sseConnected) startFallback();
      }
    };

    if ("EventSource" in window) {
      eventSource = new EventSource(`/api/stalls/${stall.slug}/orders/stream`);
      eventSource.onopen = () => {
        sseConnected = true;
        stopRealtime();
        stopFallback();
        setLiveConnection("sse");
        refreshBackendAvailability();
        refreshSilently();
      };
      eventSource.addEventListener("orders", refreshSilently);
      eventSource.onerror = () => {
        sseConnected = false;
        if (!realtimeConnected) {
          void startRealtimeFallback();
          startFallback();
        }
      };
    } else {
      void startRealtimeFallback();
      startFallback();
    }

    const safetyTimer = window.setInterval(refreshSilently, 30_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      eventSource?.close();
      stopRealtime();
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
    if (!checkoutOrder) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && updatingOrderId !== checkoutOrder.id) setCheckoutOrders([]);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkoutOrder, updatingOrderId]);

  useEffect(() => {
    if (!pendingManualPickup) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && verifyingPickupOrderId !== pendingManualPickup.orderId) {
        setPendingManualPickup(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingManualPickup, verifyingPickupOrderId]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  const filteredOrders = useMemo(() => normalizedQuery
    ? orders.filter((order) => [order.orderNo, order.tableLabel ?? "", order.customerName]
      .some((value) => value.toLocaleLowerCase("zh-TW").includes(normalizedQuery)))
    : orders, [normalizedQuery, orders]);
  const selectedItems = orders
    .filter((order) => order.source !== "OFFLINE_POS")
    .flatMap((order) => order.items.map((item) => ({ ...item, orderId: order.id })))
    .filter((item) => selectedItemIds.has(item.id));
  const selectedSourceStatus = selectedItems.length > 0
    && selectedItems.every((item) => item.status === selectedItems[0].status)
    ? selectedItems[0].status
    : null;
  const nextSelectedStatus = selectedSourceStatus ? nextOperationalItemStatus(selectedSourceStatus) : null;
  const canUpdateSelection = Boolean(nextSelectedStatus && selectedItems.every((item) => (
    canTransitionOrderItem(item.status, nextSelectedStatus, account.role)
  )));
  const kitchenGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      name: string;
      status: OrderItemStatus;
      quantity: number;
      itemIds: string[];
      notes: string;
      tickets: string[];
    }>();
    for (const order of filteredOrders) {
      if (order.source === "OFFLINE_POS") continue;
      for (const item of order.items) {
        if (item.status === "SERVED") continue;
        const notes = [
          item.noteOptions.map((option) => `${option.groupName}：${option.optionName}`).join("、"),
          item.note ?? "",
        ].filter(Boolean).join(" · ");
        const key = JSON.stringify([item.name, notes, item.status]);
        const current = groups.get(key) ?? {
          key,
          name: item.name,
          status: item.status,
          quantity: 0,
          itemIds: [],
          notes,
          tickets: [],
        };
        current.quantity += item.quantity;
        current.itemIds.push(item.id);
        current.tickets.push(`${order.orderNo}${order.tableLabel ? ` · ${order.tableLabel}` : ""}`);
        groups.set(key, current);
      }
    }
    return [...groups.values()].sort((left, right) => left.status.localeCompare(right.status) || left.name.localeCompare(right.name, "zh-TW"));
  }, [filteredOrders]);
  const diningTableGroups = useMemo(() => {
    const groups = new Map<string, { diningTableId: string; tableLabel: string; orders: OrderWithItems[] }>();
    for (const order of filteredOrders) {
      if (order.fulfillmentType !== "DINE_IN" || !order.diningTableId) continue;
      const current = groups.get(order.diningTableId) ?? {
        diningTableId: order.diningTableId,
        tableLabel: order.tableLabel ?? "未指定桌位",
        orders: [],
      };
      current.orders.push(order);
      groups.set(order.diningTableId, current);
    }
    return [...groups.values()].sort((left, right) => left.tableLabel.localeCompare(right.tableLabel, "zh-TW"));
  }, [filteredOrders]);

  const checkoutDiscount = discountOptions.find((option) => option.id === selectedDiscountOptionId) ?? null;
  const checkoutPreview = getStaffCheckoutPreview(checkoutOrders, checkoutDiscount);
  const checkoutSubtotal = checkoutPreview.subtotal;
  const checkoutTotal = checkoutPreview.total;
  const checkoutPayment = paymentOptions.find((option) => option.id === selectedPaymentOptionId) ?? null;
  const checkoutUsesCash = !modules.payment || checkoutPayment?.kind === "CASH";
  const parsedCashReceived = cashReceived === "" ? checkoutTotal : Number(cashReceived);
  const checkoutChange = checkoutUsesCash && Number.isFinite(parsedCashReceived)
    ? Math.max(0, parsedCashReceived - checkoutTotal)
    : 0;
  const checkoutNeedsApproval = Boolean(
    checkoutDiscount && checkoutDiscount.rateBps < modules.discountApprovalThresholdBps,
  );
  const operatorCanApproveDiscount = hasPermission(account.role, "APPROVE_DISCOUNT");
  const checkoutReady = Boolean(
    checkoutOrder
    && (!modules.payment || checkoutPayment)
    && (!checkoutUsesCash || (Number.isInteger(parsedCashReceived) && parsedCashReceived >= checkoutTotal))
    && (!checkoutNeedsApproval || (
      discountApprovalReason.trim()
      && (operatorCanApproveDiscount || (managerEmail.trim() && managerPassword))
    ))
  );
  const manualPickupOrder = pendingManualPickup
    ? orders.find((order) => order.id === pendingManualPickup.orderId) ?? null
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-5 md:px-8">
      <div className="flex flex-col gap-4 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-teal-800">行動訂單看板</p>
          <h1 className="text-3xl font-semibold">{stall.name}</h1>
          <p className="mt-1 text-xs text-stone-500">{account.displayName} · {roleLabels[account.role]}</p>
        </div>
        <div className="flex w-full flex-wrap justify-start gap-2 sm:w-auto sm:justify-end">
          <WorkModeSwitcher
            destinations={workModeDestinations}
            currentMode="STAFF"
            organizationId={stall.organizationId}
            stallId={stall.id}
            offlineGuardStallId={stall.id}
            className="w-full sm:w-auto"
          />
          {orderCatalog && hasPermission(account.role, "CREATE_ORDERS") ? (
            <button type="button" disabled={posConfigurationLoading} onClick={() => void openComposer()} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">
              <ShoppingCart className="h-4 w-4" />
              <span>店員點餐</span>
            </button>
          ) : null}
          {modules.dineIn ? (
            <Link href={`/staff/${stall.slug}/floor`} title="桌位平面圖" className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold">
              <MapPinned className="h-4 w-4" />
              <span className="hidden sm:inline">桌位平面圖</span>
            </Link>
          ) : null}
          {modules.print && hasPermission(account.role, "MANAGE_PRINT_QUEUE") ? (
            <Link href={`/staff/${stall.slug}/print`} title="列印工作佇列" className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold">
              <Printer className="h-4 w-4" />
              <span className="hidden lg:inline">列印佇列</span>
            </Link>
          ) : null}
          {hasPermission(account.role, "MANAGE_CASH_SHIFT") ? (
            <Link href={`/staff/${stall.slug}/cash`} title="現金交班" className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold">
              <WalletCards className="h-4 w-4" />
              <span className="hidden lg:inline">現金交班</span>
            </Link>
          ) : null}
          <LiveConnectionBadge state={liveConnection} />
          <button type="button" role="switch" aria-checked={alertsEnabled} onClick={toggleAlerts} title={alertsEnabled ? "關閉新訂單聲音與震動" : "開啟新訂單聲音與震動"} className={`inline-flex h-10 w-10 items-center justify-center rounded-md border ${alertsEnabled ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600"}`}>
            {alertsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            <span className="sr-only">{alertsEnabled ? "新訂單提醒已開啟" : "新訂單提醒已關閉"}</span>
          </button>
          <PwaControls showWakeLock />
          <OfflineBootstrapControl
            stallId={stall.id}
            stallSlug={stall.slug}
            appVersion={appVersion}
          />
          <button type="button" onClick={() => void refreshOrders()} title="重新整理" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="sr-only">重新整理</span>
          </button>
          <LogoutButton offlineStallId={stall.id} />
        </div>
      </div>
      <OfflineQueueStatus
        stallId={stall.id}
        stallSlug={stall.slug}
        onSynchronized={() => void refreshOrders(true)}
      />
      {message ? <p role="status" className={`mt-4 text-sm print:hidden ${/(無法|失敗|中斷|錯誤|期限|找不到)/.test(message) ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}
      {capacity ? <StaffCapacityControl stallSlug={stall.slug} initialData={capacity} /> : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <label className="relative block w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
          <span className="sr-only">搜尋桌號或訂單編號</span>
          <input type="search" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋桌號、訂單編號或顧客" className="h-11 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-sm" />
        </label>
        {account.role === "KITCHEN" ? (
          <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label="廚房檢視模式">
            <button type="button" aria-pressed={viewMode === "TICKETS"} onClick={() => setViewMode("TICKETS")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TICKETS" ? "bg-stone-900 text-white" : "text-stone-600"}`}>訂單票</button>
            <button type="button" aria-pressed={viewMode === "SUMMARY"} onClick={() => setViewMode("SUMMARY")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "SUMMARY" ? "bg-stone-900 text-white" : "text-stone-600"}`}>同品項彙總</button>
          </div>
        ) : modules.dineIn ? (
          <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label="訂單顯示模式">
            <button type="button" aria-pressed={viewMode === "TICKETS"} onClick={() => setViewMode("TICKETS")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TICKETS" ? "bg-stone-900 text-white" : "text-stone-600"}`}>逐筆訂單</button>
            <button type="button" aria-pressed={viewMode === "TABLES"} onClick={() => setViewMode("TABLES")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TABLES" ? "bg-stone-900 text-white" : "text-stone-600"}`}>同桌合併</button>
          </div>
        ) : null}
      </div>

      {selectedItems.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-stone-200 bg-stone-50 px-3 py-3 print:hidden">
          <span className="text-sm font-semibold">已選 {selectedItems.length} 個餐點品項</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelectedItemIds(new Set())} className="h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold">清除選取</button>
            <button type="button" disabled={!canUpdateSelection || batchBusy || !nextSelectedStatus} onClick={() => nextSelectedStatus && void updateSelectedItems(selectedItems.map((item) => item.id), nextSelectedStatus)} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><ListChecks className="h-4 w-4" />{nextSelectedStatus ? `批次${batchActionLabel(nextSelectedStatus)}` : "請選擇相同狀態"}</button>
          </div>
        </div>
      ) : null}

      {undoBatch ? (
        <div role="status" className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 print:hidden">
          <span>已更新 {undoBatch.itemCount} 個餐點，5 秒內可復原。</span>
          <button type="button" disabled={batchBusy} onClick={() => void undoSelectedItems()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-amber-700 px-3 text-xs font-semibold"><Undo2 className="h-4 w-4" />復原</button>
        </div>
      ) : null}

      {account.role === "KITCHEN" && viewMode === "SUMMARY" ? (
        <div className="mt-6 divide-y divide-stone-200 border-y border-stone-200 print:hidden">
          {kitchenGroups.map((group) => {
            const nextStatus = nextOperationalItemStatus(group.status);
            const canUpdate = nextStatus && canTransitionOrderItem(group.status, nextStatus, account.role);
            return <article key={group.key} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><ChefHat className="h-4 w-4 text-teal-700" /><h2 className="font-semibold">{group.quantity} × {group.name}</h2><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{orderItemStatusLabels[group.status]}</span></div>{group.notes ? <p className="mt-1 text-xs text-teal-800">{group.notes}</p> : null}<p className="mt-2 text-xs text-stone-500">來源：{group.tickets.join("、")}</p></div>{canUpdate && nextStatus ? <button type="button" disabled={batchBusy} onClick={() => void updateSelectedItems(group.itemIds, nextStatus)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><ListChecks className="h-4 w-4" />{batchActionLabel(nextStatus)}全部</button> : null}</article>;
          })}
          {kitchenGroups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">目前沒有待製作餐點。</p> : null}
        </div>
      ) : viewMode === "TABLES" ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 print:hidden">
          {diningTableGroups.map((group) => {
            const allServed = group.orders.every((order) => order.items.every((item) => item.status === "SERVED"));
            const checkoutEligible = allServed && group.orders.every((order) => order.status === "READY");
            const unpaidOrders = group.orders.filter((order) => order.paymentStatus === "UNPAID");
            const pendingItems = group.orders.flatMap((order) => order.items).filter((item) => item.status !== "SERVED").length;
            return (
              <article key={group.diningTableId} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="text-lg font-semibold">{group.tableLabel}</h2><p className="mt-1 text-xs text-stone-500">{group.orders.length} 筆追加訂單 · {group.orders.reduce((sum, order) => sum + order.items.reduce((count, item) => count + item.quantity, 0), 0)} 份餐點</p></div>
                  <strong>{formatMoney(group.orders.reduce((sum, order) => sum + order.total, 0), stall.currency)}</strong>
                </div>
                <div className="mt-4 divide-y divide-stone-100 border-y border-stone-200">{group.orders.map((order) => <div key={order.id} className="py-3"><div className="flex items-center justify-between gap-3 text-sm"><strong>訂單 {order.orderNo}</strong><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{orderStatusLabels[order.status]}</span></div><p className="mt-1 text-xs text-stone-600">{order.items.map((item) => `${item.quantity}×${item.name}`).join("、")}</p><p className="mt-1 text-xs text-stone-500">{paymentStatusLabels[order.paymentStatus]}</p></div>)}</div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className={`text-xs font-semibold ${pendingItems === 0 ? "text-emerald-700" : "text-amber-800"}`}>{pendingItems === 0 ? "餐點皆已出餐" : `${pendingItems} 個品項尚未出餐`}</span>
                  <button type="button" disabled={!checkoutEligible || updatingOrderId !== null || posConfigurationLoading} onClick={() => unpaidOrders.length > 0 ? void openCheckout(unpaidOrders) : void completePaidOrders(group.orders)} className="h-10 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{unpaidOrders.length > 0 ? unpaidOrders.length > 1 ? `合併結帳（${unpaidOrders.length} 筆）` : "完成此桌結帳" : "完成此桌"}</button>
                </div>
              </article>
            );
          })}
          {diningTableGroups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500 md:col-span-2">目前沒有內用桌位訂單。</p> : null}
        </div>
      ) : (
      <div className="mt-6 grid gap-4 md:grid-cols-2 print:block">
        {filteredOrders.map((order) => (
          <article
            key={order.id}
            className={`rounded-lg border p-4 ${orderAgeClasses(order.createdAt, now)}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-stone-500"><span>訂單 {order.orderNo}</span>{order.isTest ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">開店測試訂單</span> : null}{order.source === "OFFLINE_POS" ? <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-900">本機待同步</span> : null}</div>
                <h2 className="mt-1 font-semibold">{order.customerName}</h2>
                <p className="mt-1 text-sm text-stone-500">
                  {order.fulfillmentType === "DINE_IN"
                    ? `內用 · ${order.tableLabel ?? "未指定桌位"}`
                    : order.fulfillmentType === "DELIVERY" ? "外送訂單" : "外帶取餐"} · {new Date(order.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} · 已等待 {orderAgeMinutes(order.createdAt, now)} 分
                </p>
              </div>
              <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">{orderStatusLabels[order.status]}</span>
            </div>
            {order.fulfillmentType === "DELIVERY" ? (
              <div className="mt-3 flex items-start gap-2 border-y border-stone-200 bg-stone-50 px-3 py-3 text-sm">
                <Truck className="mt-0.5 h-4 w-4 shrink-0 text-teal-800" />
                <div className="min-w-0"><p className="font-medium break-words">{order.deliveryAddress}</p>{order.customerPhone ? <p className="mt-1 text-stone-600">{order.customerPhone}</p> : null}</div>
              </div>
            ) : null}
            {order.status === "WAITING_CONFIRMATION" ? (
              <p className="mt-3 text-xs font-medium text-amber-800">確認後才可開始製作；逾時時間 {new Date(order.confirmationExpiresAt).toLocaleTimeString("zh-TW")}</p>
            ) : null}
            {order.status !== "WAITING_CONFIRMATION" ? (
              <div className="mt-4 flex flex-wrap gap-2 print:hidden">
                {order.items.some((item) => item.status === "PENDING")
                  && canTransitionOrderItem("PENDING", "PREPARING", account.role) ? (
                    <button
                      type="button"
                      disabled={updatingItemsOrderId === order.id || updatingItemId !== null}
                      onClick={() => void updateAllItemStatuses(order.id, "PREPARING")}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="h-4 w-4" />
                      全部開始製作（{order.items.filter((item) => item.status === "PENDING").length}）
                    </button>
                  ) : null}
                {order.items.some((item) => item.status === "PREPARING")
                  && canTransitionOrderItem("PREPARING", "READY", account.role) ? (
                    <button
                      type="button"
                      disabled={updatingItemsOrderId === order.id || updatingItemId !== null}
                      onClick={() => void updateAllItemStatuses(order.id, "READY")}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCheck className="h-4 w-4" />
                      全部餐點完成（{order.items.filter((item) => item.status === "PREPARING").length}）
                    </button>
                  ) : null}
                {order.items.some((item) => item.status === "READY")
                  && canTransitionOrderItem("READY", "SERVED", account.role) ? (
                    <button
                      type="button"
                      disabled={updatingItemsOrderId === order.id || updatingItemId !== null}
                      onClick={() => void updateAllItemStatuses(order.id, "SERVED")}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-800 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <PackageCheck className="h-4 w-4" />
                      全部標記已出餐（{order.items.filter((item) => item.status === "READY").length}）
                    </button>
                  ) : null}
              </div>
            ) : null}
            <ul className="mt-4 divide-y divide-stone-100 border-y border-stone-200 text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="relative grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  {order.source !== "OFFLINE_POS" && canSelectItem(item.status, order.status, account.role) ? <input type="checkbox" aria-label={`選取 ${order.orderNo} 的 ${item.name}`} checked={selectedItemIds.has(item.id)} onChange={(event) => setSelectedItemIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} className="absolute left-0 top-4 h-4 w-4 print:hidden" /> : null}
                  <div className={`min-w-0 ${order.source !== "OFFLINE_POS" && canSelectItem(item.status, order.status, account.role) ? "pl-7" : ""}`}>
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
                  {order.source !== "OFFLINE_POS" && item.status !== "SERVED" && order.status !== "WAITING_CONFIRMATION" ? (
                    <ItemStatusButton
                      itemStatus={item.status}
                      role={account.role}
                      busy={updatingItemId === item.id || updatingItemsOrderId === order.id}
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

            {modules.print && !order.isTest ? (
              <button
                type="button"
                onClick={() => void printOrder(order.id)}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-medium hover:bg-stone-100 print:hidden"
              >
                <Printer className="h-4 w-4" />排入列印
              </button>
            ) : null}

            {order.status === "READY" && order.fulfillmentType === "TAKEOUT" && order.source === "QR_MENU" && hasPermission(account.role, "CHECKOUT_ORDERS") ? (
              order.pickupVerifiedAt ? (
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-teal-800">
                  <CheckCircle2 className="h-4 w-4" />
                  {order.pickupVerificationMethod === "MANUAL" ? "已完成人工取餐核對" : "取餐碼已驗證"}
                </div>
              ) : (
                <div className="mt-4">
                  <div className="relative">
                    <input type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      aria-label={`${order.pickupCodeLength === 6 ? "六" : "三"}位數取餐碼`}
                      aria-busy={verifyingPickupOrderId === order.id}
                      disabled={verifyingPickupOrderId === order.id}
                      maxLength={order.pickupCodeLength === 6 ? 6 : 3}
                      pattern={order.pickupCodeLength === 6 ? "[0-9]{6}" : "[0-9]{3}"}
                      value={pickupCodes[order.id] ?? ""}
                      onChange={(event) => handlePickupCodeChange(order.id, event.target.value)}
                      className="h-11 w-full rounded-md border border-stone-300 px-3 pr-11 font-mono text-lg disabled:bg-stone-50"
                      placeholder={`${order.pickupCodeLength === 6 ? "六" : "三"}位取餐碼`}
                    />
                    {verifyingPickupOrderId === order.id ? (
                      <span className="absolute inset-y-0 right-3 grid place-items-center text-teal-700" role="status">
                        <LoaderCircle className="h-5 w-5 animate-spin" />
                        <span className="sr-only">正在驗證取餐碼</span>
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={verifyingPickupOrderId === order.id}
                    onClick={() => setPendingManualPickup({
                      orderId: order.id,
                      reason: "DEVICE_LOST",
                      confirmedCustomerDetails: false,
                    })}
                    className="mt-2 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-stone-700 hover:text-stone-950 disabled:opacity-50"
                  >
                    <KeyRound className="h-4 w-4" />無法取得取餐碼
                  </button>
                </div>
              )
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">
              {staffStatusOptions
                .filter((option) => canTransitionOrder(order.status, option.value, account.role))
                .filter((option) => option.value !== "PREPARING" && option.value !== "READY")
                .filter((option) => order.source !== "OFFLINE_POS" || option.value === "COMPLETED" || option.value === "CANCELLED")
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
                          reason: "CUSTOMER_CANCELLED",
                          detail: "",
                        });
                        return;
                      }
                      if (option.value === "COMPLETED") {
                        if (order.paymentStatus === "PAID") void updateOrder(order.id, "COMPLETED");
                        else void openCheckout(order);
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
      )}
      {viewMode === "TICKETS" && filteredOrders.length === 0 ? <p className="mt-10 text-center text-sm text-stone-500 print:hidden">{query ? "找不到符合條件的訂單。" : "目前沒有待處理訂單。"}</p> : null}

      {composerOpen && orderCatalog ? (
        <StaffOrderComposer
          stall={stall}
          catalog={orderCatalog}
          account={account}
          modules={modules}
          paymentOptions={paymentOptions}
          discountOptions={discountOptions}
          discountSettingsHref={hasPermission(account.role, "MANAGE_STALL") ? `/merchant/stalls/${stall.id}/settings/modules?source=staff#discount-options` : undefined}
          onCreated={handleStaffOrderCreated}
          onClose={() => setComposerOpen(false)}
        />
      ) : null}

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
                <h2 id="checkout-title" className="text-lg font-semibold">{checkoutOrders.length > 1 ? "同桌合併結帳" : "完成訂單"}</h2>
                <p className="mt-1 text-sm text-stone-600">
                  {checkoutOrders.length > 1 ? `${checkoutOrder.tableLabel} · ${checkoutOrders.length} 筆訂單` : `訂單 ${checkoutOrder.orderNo} · ${checkoutOrder.fulfillmentType === "DINE_IN" ? checkoutOrder.tableLabel : checkoutOrder.customerName}`}
                </p>
                {checkoutOrders.length > 1 ? <p className="mt-1 text-xs text-stone-500">{checkoutOrders.map((order) => order.orderNo).join("、")}</p> : null}
              </div>
              <button
                type="button"
                title="關閉結帳視窗"
                disabled={updatingOrderId === checkoutOrder.id}
                onClick={() => setCheckoutOrders([])}
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

            <StaffDiscountSelector
              enabled={modules.discount}
              options={discountOptions}
              selectedOptionId={selectedDiscountOptionId}
              onSelect={setSelectedDiscountOptionId}
              settingsHref={hasPermission(account.role, "MANAGE_STALL") ? `/merchant/stalls/${stall.id}/settings/modules?source=staff#discount-options` : undefined}
              existingDiscountLabel={checkoutPreview.discountAmount > 0
                ? checkoutPreview.discountLabel ?? "訂單既有折扣"
                : null}
            />

            {checkoutNeedsApproval ? (
              <div className="mt-5 rounded-md border border-amber-300 bg-amber-50 p-4">
                <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" /><div><h3 className="text-sm font-semibold text-amber-950">此折扣超過店員免核准門檻</h3><p className="mt-1 text-xs text-amber-900">請填寫原因；店員另須由經理輸入帳號密碼驗證。</p></div></div>
                <label className="mt-3 block text-xs font-semibold text-stone-700">折扣原因<input type="text" value={discountApprovalReason} maxLength={200} onChange={(event) => setDiscountApprovalReason(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label>
                {!operatorCanApproveDiscount ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-stone-700">經理帳號<input type="email" autoComplete="username" value={managerEmail} maxLength={254} onChange={(event) => setManagerEmail(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label><label className="text-xs font-semibold text-stone-700">經理密碼<input type="password" autoComplete="current-password" value={managerPassword} maxLength={128} onChange={(event) => setManagerPassword(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label></div> : <p className="mt-3 text-xs font-semibold text-emerald-800">您的角色可直接核准，系統仍會記錄操作員與原因。</p>}
              </div>
            ) : null}

            <dl className="mt-5 space-y-2 border-y border-stone-200 py-4 text-sm">
              <div className="flex justify-between"><dt>商品小計</dt><dd>{formatMoney(checkoutSubtotal, stall.currency)}</dd></div>
              {checkoutPreview.discountAmount > 0 ? <div className="flex justify-between text-emerald-800"><dt>{checkoutPreview.discountLabel ?? "訂單既有折扣"}</dt><dd>-{formatMoney(checkoutPreview.discountAmount, stall.currency)}</dd></div> : null}
              <div className="flex justify-between text-lg font-semibold"><dt>應收金額</dt><dd>{formatMoney(checkoutTotal, stall.currency)}</dd></div>
            </dl>

            {checkoutUsesCash ? (
              <div className="mt-5">
                <label className="text-xs font-semibold text-stone-600" htmlFor="cash-received">客戶實收金額</label>
                <input type="text"
                  id="cash-received"
                  inputMode="numeric"
                  maxLength={9}
                  pattern="[0-9]{0,9}"
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

            {message ? (
              <div role="alert" className="mt-5 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="font-semibold">{message}</p>
                </div>
                {message === "現金交易前必須先開啟現金班次。" ? (
                  <Link
                    href={`/staff/${stall.slug}/cash`}
                    className="mt-3 inline-flex min-h-10 items-center rounded-md bg-teal-800 px-4 py-2 font-semibold text-white"
                  >
                    前往現金交班
                  </Link>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={updatingOrderId === checkoutOrder.id}
                onClick={() => setCheckoutOrders([])}
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

      {pendingManualPickup && manualPickupOrder ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4 print:hidden">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="manual-pickup-title"
            aria-describedby="manual-pickup-description"
            className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="manual-pickup-title" className="text-lg font-semibold">人工核對取餐</h2>
                <p className="mt-1 text-sm font-medium text-stone-800">
                  訂單 {manualPickupOrder.orderNo} · {manualPickupOrder.customerName}
                </p>
              </div>
              <button
                type="button"
                title="關閉人工核對視窗"
                disabled={verifyingPickupOrderId === manualPickupOrder.id}
                onClick={() => setPendingManualPickup(null)}
                className="grid h-9 w-9 place-items-center rounded-md border border-stone-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p id="manual-pickup-description" className="mt-4 text-sm leading-6 text-stone-600">
              僅限顧客無法開啟訂單追蹤頁時使用。請先向顧客核對稱呼與餐點內容，系統會保留人工放行紀錄。
            </p>
            <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-200 text-sm">
              {manualPickupOrder.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 py-2">
                  <span>{item.quantity} × {item.name}</span>
                  <span className="text-stone-500">{orderItemStatusLabels[item.status]}</span>
                </li>
              ))}
            </ul>
            <label className="mt-4 block text-xs font-semibold text-stone-600">
              無法取得原因
              <select
                value={pendingManualPickup.reason}
                onChange={(event) => setPendingManualPickup((current) => current ? {
                  ...current,
                  reason: event.target.value as ManualPickupReason,
                } : null)}
                className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
              >
                <option value="DEVICE_LOST">顧客手機遺失或無法使用</option>
                <option value="TRACKING_UNAVAILABLE">訂單追蹤頁無法開啟</option>
                <option value="OTHER">其他已核實原因</option>
              </select>
            </label>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-stone-700">
              <input
                type="checkbox"
                checked={pendingManualPickup.confirmedCustomerDetails}
                onChange={(event) => setPendingManualPickup((current) => current ? {
                  ...current,
                  confirmedCustomerDetails: event.target.checked,
                } : null)}
                className="mt-1 h-4 w-4"
              />
              已向顧客核對稱呼與全部餐點內容
            </label>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={verifyingPickupOrderId === manualPickupOrder.id}
                onClick={() => setPendingManualPickup(null)}
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                返回
              </button>
              <button
                type="button"
                disabled={
                  verifyingPickupOrderId === manualPickupOrder.id
                  || !pendingManualPickup.confirmedCustomerDetails
                }
                onClick={() => void verifyManualPickup()}
                className="rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifyingPickupOrderId === manualPickupOrder.id ? "核對中…" : "確認人工取餐"}
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
            <label className="mt-4 block text-xs font-semibold text-stone-700">取消原因<select value={pendingCancellation.reason} onChange={(event) => setPendingCancellation((current) => current ? { ...current, reason: event.target.value as CancellationReason } : null)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{cancellationReasonOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="mt-4 block text-xs font-semibold text-stone-700">補充說明{pendingCancellation.reason === "OTHER" ? "（必填）" : "（選填）"}<textarea value={pendingCancellation.detail} maxLength={200} onChange={(event) => setPendingCancellation((current) => current ? { ...current, detail: event.target.value } : null)} className="mt-1 min-h-20 w-full resize-y rounded-md border border-stone-300 p-3 text-sm" /></label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                autoFocus
                disabled={updatingOrderId === pendingCancellation.id || (pendingCancellation.reason === "OTHER" && !pendingCancellation.detail.trim())}
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

async function loadOfflineStaffOrders(stallId: string): Promise<StaffOrderDto[]> {
  if (!("indexedDB" in window)) return [];
  try {
    const [{ listUnsynchronizedOfflineOrders }, { offlineOrderToStaffOrder }] = await Promise.all([
      import("@/offline/offline-operations"),
      import("@/offline/offline-staff-order"),
    ]);
    return (await listUnsynchronizedOfflineOrders(stallId))
      .filter((order) => order.orderStatus !== "LOCAL_COMPLETED" && order.orderStatus !== "LOCAL_CANCELLED")
      .map(offlineOrderToStaffOrder);
  } catch {
    return [];
  }
}

function mergeStaffOrders(
  onlineOrders: StaffOrderDto[],
  offlineOrders: StaffOrderDto[],
) {
  const merged = new Map(onlineOrders.map((order) => [order.id, order]));
  offlineOrders.forEach((order) => merged.set(order.id, order));
  return [...merged.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function LiveConnectionBadge({ state }: { state: LiveConnectionState }) {
  const connected = state === "sse" || state === "realtime";
  const label = state === "sse"
    ? "SSE 即時"
    : state === "realtime"
      ? "Realtime 備援"
      : state === "polling"
        ? "5 秒輪詢"
        : "連線中";
  const title = state === "sse"
    ? "已連上授權 SSE，事件只觸發重新取得伺服器資料"
    : state === "realtime"
      ? "SSE 未就緒，已切換 Supabase Realtime 通知"
      : state === "polling"
        ? "SSE 與 Realtime 未就緒，已啟用 5 秒輪詢"
        : "正在建立即時更新連線";

  return (
    <span
      role="status"
      className={`inline-flex h-10 items-center gap-1.5 text-xs font-medium ${connected ? "text-emerald-700" : "text-amber-700"}`}
      title={title}
    >
      {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      <span className="hidden sm:inline">{label}</span>
    </span>
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

function nextOperationalItemStatus(status: OrderItemStatus) {
  return status === "PENDING" ? "PREPARING" as const
    : status === "PREPARING" ? "READY" as const
      : status === "READY" ? "SERVED" as const
        : null;
}

function canSelectItem(status: OrderItemStatus, orderStatus: OrderStatus, role: UserRole) {
  if (orderStatus === "WAITING_CONFIRMATION") return false;
  const next = nextOperationalItemStatus(status);
  return Boolean(next && canTransitionOrderItem(status, next, role));
}

function batchActionLabel(status: "PREPARING" | "READY" | "SERVED") {
  return status === "PREPARING" ? "開始製作" : status === "READY" ? "餐點完成" : "標記已出餐";
}

function orderAgeMinutes(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
}

function orderAgeClasses(createdAt: string, now: number) {
  const minutes = orderAgeMinutes(createdAt, now);
  if (minutes >= 20) return "border-red-300 bg-red-50";
  if (minutes >= 10) return "border-amber-300 bg-amber-50";
  return "border-stone-200 bg-white";
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
    // Some mobile browsers block audio until a user gesture; vibration still applies.
  }
}
