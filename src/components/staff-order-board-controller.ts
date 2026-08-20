"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserRole } from "@prisma/client";
import type { StaffOrderCheckoutRequest } from "@/components/staff-order-board-checkout";
import {
  useStaffOrderCheckout,
} from "@/components/staff-order-board-checkout-lifecycle";
import {
  useStaffOrderCancellation,
} from "@/components/staff-order-board-cancellation";
import {
  useStaffOrderManualPickup,
} from "@/components/staff-order-board-manual-pickup";
import {
  useStaffOrderTimeProposal,
} from "@/components/staff-order-board-time-proposal";
import { useStaffOrderProductionLifecycle } from "@/components/staff-order-board-production-lifecycle";
import {
  fulfillmentTimeNeedsResponse,
  nextOperationalItemStatus,
  type StaffOrderBoardPresentationProps,
  type StaffOrderBoardViewMode,
} from "@/components/staff-order-board-presentation";
import {
  checkoutStaffDiningTable,
  queueStaffOrderPrint,
  verifyStaffOrderPickup,
  type StaffOrderManualPickupReason,
} from "@/components/staff-order-board-fulfillment";
import {
  updateStaffOrderFulfillmentTime,
  type StaffOrderFulfillmentTimeCommand,
} from "@/components/staff-order-board-fulfillment-time";
import {
  browserStaffOrderLiveEnvironment,
  startStaffOrderLiveLifecycle,
  type StaffOrderLiveConnectionState,
} from "@/components/staff-order-board-live";
import {
  loadOfflineStaffOrders,
  refreshStaffOrdersAfterOfflineSync,
  startStaffOrderOfflineIntake,
} from "@/components/staff-order-board-offline";
import {
  loadStaffOrderPosConfiguration,
  prepareStaffOrderComposerIntake,
  selectStaffOrderPosSnapshot,
  type StaffOrderPosConfiguration,
  type StaffOrderPosSnapshot,
} from "@/components/staff-order-board-pos";
import {
  loadStaffOrderSnapshot,
  type StaffOrderSnapshot,
} from "@/components/staff-order-board-refresh";
import {
  filterStaffOrders,
  selectStaffOrderDiningTableGroups,
  selectStaffOrderKitchenGroups,
} from "@/components/staff-order-board-selectors";
import type { LiveResourceController } from "@/lib/use-live-resource";
import { canTransitionOrderItem } from "@/lib/order-item-status";
import type { StaffOrderDto } from "@/lib/orders";
import { isCompletePickupCode, normalizePickupCode } from "@/lib/pickup-code";
import type { WorkModeDestination } from "@/lib/work-mode";

type OrderWithItems = StaffOrderDto;

export type StaffOrderBoardControllerInput = {
  stall: { id: string; organizationId: string; slug: string; name: string; currency: string; timezone: string };
  initialOrders: OrderWithItems[];
  initialNow: number;
  account: { displayName: string; role: UserRole };
  modules: StaffOrderPosSnapshot["modules"];
  paymentOptions: StaffOrderPosSnapshot["paymentOptions"];
  discountOptions: StaffOrderPosSnapshot["discountOptions"];
  orderCatalog: StaffOrderPosSnapshot["catalog"];
  capacity: StaffOrderPosSnapshot["capacity"];
  workModeDestinations: WorkModeDestination[];
  appVersion: string;
};

export function useStaffOrderBoardController({
  stall,
  initialOrders,
  initialNow,
  account,
  modules: initialModules,
  paymentOptions: initialPaymentOptions,
  discountOptions: initialDiscountOptions,
  orderCatalog: initialOrderCatalog,
  capacity: initialCapacity,
  workModeDestinations,
  appVersion,
}: StaffOrderBoardControllerInput): StaffOrderBoardPresentationProps {
  const knownOrderIdsRef = useRef(new Set(initialOrders.map((order) => order.id)));
  const alertsEnabledRef = useRef(false);
  const [orders, setOrders] = useState(initialOrders);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [verifyingPickupOrderId, setVerifyingPickupOrderId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveConnection, setLiveConnection] = useState<StaffOrderLiveConnectionState>("connecting");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(initialNow);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<StaffOrderBoardViewMode>("TICKETS");
  const [composerOpen, setComposerOpen] = useState(false);
  const [posSnapshot, setPosSnapshot] = useState<StaffOrderPosSnapshot>({
    modules: initialModules,
    paymentOptions: initialPaymentOptions,
    discountOptions: initialDiscountOptions,
    catalog: initialOrderCatalog,
    capacity: initialCapacity,
  });
  const [posConfigurationLoading, setPosConfigurationLoading] = useState(false);
  const production = useStaffOrderProductionLifecycle({
    stallSlug: stall.slug,
    orders,
    setOrders,
    setMessage,
  });
  const {
    batchBusy,
    clearSelectedItems,
    reconcile: reconcileProduction,
    selectedItemIds,
    setUpdatingOrderId,
    undoBatch,
    undoSelectedItems,
    updateAllItemStatuses,
    updateItemStatus,
    updateOrder,
    updateSelectedItems,
    updatingItemId,
    updatingItemsOrderId,
    updatingOrderId,
  } = production;
  const cancellation = useStaffOrderCancellation({
    updatingOrderId,
    onConfirm: (orderId, options) => updateOrder(orderId, "CANCELLED", options),
  });
  const reconcileCancellation = cancellation.reconcile;
  const manualPickup = useStaffOrderManualPickup({
    verifyingPickupOrderId,
    onConfirm: confirmManualPickup,
  });
  const reconcileManualPickup = manualPickup.reconcile;
  const {
    modules,
    paymentOptions,
    discountOptions,
    catalog: orderCatalog,
    capacity,
  } = posSnapshot;
  const timeProposal = useStaffOrderTimeProposal({
    slotValues: orderCatalog?.fulfillmentSlots,
    timeZone: stall.timezone,
    updatingOrderId,
    onUnavailable: () => setMessage("目前沒有可提供給顧客的預約時段，請先檢查營業時間與預約設定。"),
    onConfirm: confirmTimeProposal,
  });
  const reconcileTimeProposal = timeProposal.reconcile;
  const checkout = useStaffOrderCheckout({
    modules,
    paymentOptions,
    discountOptions,
    role: account.role,
    updatingOrderId,
    onCompleteSingle: completeSingleCheckout,
    onCompleteTable: completeTableCheckout,
    onInvalidTable: () => setMessage("只能合併結帳同一桌的內用訂單。"),
  });
  const reconcileCheckout = checkout.reconcile;

  async function refreshPosConfiguration(
    includeCatalog = false,
  ): Promise<StaffOrderPosConfiguration | null> {
    setPosConfigurationLoading(true);
    try {
      return await loadStaffOrderPosConfiguration({
        stallSlug: stall.slug,
        includeCatalog,
      });
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

  const loadOrderSnapshot = useCallback((signal?: AbortSignal) => loadStaffOrderSnapshot({
    stallId: stall.id,
    stallSlug: stall.slug,
    fetchImpl: (input, init) => fetch(input, { ...init, signal }),
    loadOfflineOrders: loadOfflineStaffOrders,
  }), [stall.id, stall.slug]);

  const applyOrderSnapshot = useCallback((snapshot: StaffOrderSnapshot) => {
    const newWaitingOrders = snapshot.mergedOrders.filter((order) => (
      order.status === "WAITING_CONFIRMATION" && !knownOrderIdsRef.current.has(order.id)
    ));
    snapshot.mergedOrders.forEach((order) => knownOrderIdsRef.current.add(order.id));
    if (newWaitingOrders.length > 0) notifyNewOrders(newWaitingOrders.length);
    setOrders(snapshot.mergedOrders);
    reconcileProduction(snapshot.mergedOrders);
    reconcileCancellation(snapshot.onlineOrders);
    reconcileManualPickup(snapshot.onlineOrders);
    reconcileTimeProposal(snapshot.onlineOrders);
    reconcileCheckout(snapshot.onlineOrders);
  }, [notifyNewOrders, reconcileCancellation, reconcileCheckout, reconcileManualPickup, reconcileProduction, reconcileTimeProposal]);

  const liveControllerRef = useRef<LiveResourceController | null>(null);
  const manualRefreshActiveRef = useRef(false);
  const refreshOrders = useCallback(
    async (silent = false) => {
      if (!silent) {
        manualRefreshActiveRef.current = true;
        setMessage("");
        setIsRefreshing(true);
      }
      try {
        await liveControllerRef.current?.refresh();
      } finally {
        if (!silent) {
          manualRefreshActiveRef.current = false;
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => startStaffOrderOfflineIntake({
    stallId: stall.id,
    knownOrderIds: knownOrderIdsRef.current,
    updateOrders: setOrders,
  }), [stall.id]);

  function toggleAlerts() {
    const next = !alertsEnabledRef.current;
    alertsEnabledRef.current = next;
    setAlertsEnabled(next);
    window.localStorage.setItem("stallorder_staff_order_alerts", next ? "enabled" : "disabled");
    if (next) playNotificationTone();
  }

  async function updateFulfillmentTime(
    order: OrderWithItems,
    command: StaffOrderFulfillmentTimeCommand,
  ) {
    setMessage("");
    setUpdatingOrderId(order.id);
    try {
      const updatedOrder = await updateStaffOrderFulfillmentTime({
        stallSlug: stall.slug,
        orderId: order.id,
        command,
      });
      setOrders((current) => current.map((candidate) => (
        candidate.id === order.id ? updatedOrder : candidate
      )));
      setMessage(command.operation === "PROPOSE"
        ? "已通知顧客確認新的時間；顧客回覆前不會開始製作。"
        : "已接受顧客指定時間。"
      );
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新取餐或送達時間。");
      return false;
    } finally {
      setUpdatingOrderId(null);
    }
  }

  async function confirmTimeProposal(
    orderId: string,
    command: StaffOrderFulfillmentTimeCommand,
  ) {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) return false;
    return updateFulfillmentTime(order, command);
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
    const intake = prepareStaffOrderComposerIntake(posSnapshot, latest);
    if (!intake) return;
    setPosSnapshot(intake);
    setComposerOpen(true);
  }

  async function openCheckout(orderOrOrders: OrderWithItems | OrderWithItems[]) {
    setMessage("");
    const latest = await refreshPosConfiguration();
    const activeSnapshot = selectStaffOrderPosSnapshot(posSnapshot, latest);
    setPosSnapshot(activeSnapshot);
    const ordersToCheckout = Array.isArray(orderOrOrders) ? orderOrOrders : [orderOrOrders];
    checkout.open({
      orders: ordersToCheckout,
      modules: activeSnapshot.modules,
      paymentOptions: activeSnapshot.paymentOptions,
    });
  }

  function completeSingleCheckout(
    order: OrderWithItems,
    checkoutRequest: StaffOrderCheckoutRequest,
  ) {
    return updateOrder(order.id, "COMPLETED", { checkout: checkoutRequest });
  }

  async function completeTableCheckout({
    diningTableId,
    checkoutOrders,
    checkout: checkoutRequest,
  }: {
    diningTableId: string;
    checkoutOrders: OrderWithItems[];
    checkout: StaffOrderCheckoutRequest;
  }) {
    setUpdatingOrderId(checkoutOrders[0].id);
    setMessage("");
    try {
      const completedIds = new Set(await checkoutStaffDiningTable({
        stallSlug: stall.slug,
        diningTableId,
        orderIds: checkoutOrders.map((order) => order.id),
        checkout: checkoutRequest,
      }));
      setOrders((current) => current.filter((order) => !completedIds.has(order.id)));
      setMessage(`已合併完成 ${completedIds.size} 筆同桌訂單。`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      return false;
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
      setMessage(await queueStaffOrderPrint({
        stallSlug: stall.slug,
        orderId,
        orderSource: order?.source,
      }));
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
      const pickup = await verifyStaffOrderPickup({
        stallSlug: stall.slug,
        orderId,
        command: { mode: "CODE", code },
      });
      setOrders((current) => current.map((order) => (
        order.id === orderId ? {
          ...order,
          ...pickup,
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

  async function confirmManualPickup(orderId: string, reason: StaffOrderManualPickupReason) {
    if (verifyingPickupOrderId === orderId) return false;
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) return false;

    setMessage("");
    setVerifyingPickupOrderId(order.id);
    try {
      const pickup = await verifyStaffOrderPickup({
        stallSlug: stall.slug,
        orderId: order.id,
        command: {
          mode: "MANUAL",
          confirmationOrderNo: order.orderNo,
          reason,
          confirmedCustomerDetails: true,
        },
      });
      setOrders((current) => current.map((candidate) => (
        candidate.id === order.id ? {
          ...candidate,
          ...pickup,
        } : candidate
      )));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      return false;
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
    const controller = startStaffOrderLiveLifecycle({
      stallId: stall.id,
      stallSlug: stall.slug,
      environment: browserStaffOrderLiveEnvironment(),
      load: loadOrderSnapshot,
      onData: applyOrderSnapshot,
      onError: (error) => {
        if (!manualRefreshActiveRef.current) return;
        setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      },
      refreshBackendAvailability: () => {
        void fetch("/api/availability/config", { cache: "no-store" }).catch(() => undefined);
      },
      onConnectionChange: setLiveConnection,
    });
    liveControllerRef.current = controller;
    return () => {
      controller.stop();
      if (liveControllerRef.current === controller) liveControllerRef.current = null;
    };
  }, [applyOrderSnapshot, loadOrderSnapshot, stall.id, stall.slug]);

  const filteredOrders = useMemo(() => filterStaffOrders(orders, query), [orders, query]);
  const selectedItems = orders
    .filter((order) => order.source !== "OFFLINE_POS")
    .flatMap((order) => order.items.map((item) => ({
      ...item,
      orderId: order.id,
      fulfillmentTimeState: order.fulfillmentTimeState,
    })))
    .filter((item) => selectedItemIds.has(item.id));
  const selectedSourceStatus = selectedItems.length > 0
    && selectedItems.every((item) => item.status === selectedItems[0].status)
    ? selectedItems[0].status
    : null;
  const nextSelectedStatus = selectedSourceStatus ? nextOperationalItemStatus(selectedSourceStatus) : null;
  const canUpdateSelection = Boolean(nextSelectedStatus && selectedItems.every((item) => (
    canTransitionOrderItem(item.status, nextSelectedStatus, account.role)
    && !(nextSelectedStatus === "PREPARING" && fulfillmentTimeNeedsResponse(item.fulfillmentTimeState))
  )));
  const kitchenGroups = useMemo(
    () => selectStaffOrderKitchenGroups(filteredOrders),
    [filteredOrders],
  );
  const diningTableGroups = useMemo(
    () => selectStaffOrderDiningTableGroups(filteredOrders),
    [filteredOrders],
  );

  return {
    stall,
    account,
    modules,
    paymentOptions,
    discountOptions,
    orderCatalog,
    capacity,
    workModeDestinations,
    appVersion,
    filteredOrders,
    orders,
    selectedItems,
    canUpdateSelection,
    nextSelectedStatus,
    kitchenGroups,
    diningTableGroups,
    selectedItemIds,
    pickupCodes,
    query,
    now,
    viewMode,
    liveConnection,
    alertsEnabled,
    isRefreshing,
    message,
    batchBusy,
    undoBatch,
    composerOpen,
    posConfigurationLoading,
    updatingOrderId,
    updatingItemId,
    updatingItemsOrderId,
    verifyingPickupOrderId,
    cancellation,
    checkout,
    manualPickup,
    timeProposal,
    actions: {
      onClearSelectedItems: clearSelectedItems,
      onCloseComposer: () => setComposerOpen(false),
      onCompletePaidOrders: completePaidOrders,
      onCreated: handleStaffOrderCreated,
      onOpenCheckout: openCheckout,
      onOpenComposer: openComposer,
      onPickupCodeChange: handlePickupCodeChange,
      onPrintOrder: printOrder,
      onQueryChange: setQuery,
      onRefresh: () => void refreshOrders(),
      onSynchronized: () => void refreshStaffOrdersAfterOfflineSync(refreshOrders),
      onToggleAlerts: toggleAlerts,
      onToggleSelectedItem: production.toggleSelectedItem,
      onUndoSelectedItems: undoSelectedItems,
      onUpdateAllItemStatuses: updateAllItemStatuses,
      onUpdateFulfillmentTime: updateFulfillmentTime,
      onUpdateItemStatus: updateItemStatus,
      onUpdateOrder: updateOrder,
      onUpdateSelectedItems: updateSelectedItems,
      onViewModeChange: setViewMode,
    },
  };
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
