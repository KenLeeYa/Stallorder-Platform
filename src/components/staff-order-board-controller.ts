"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserRole } from "@prisma/client";
import { useOperationsLocale } from "@/components/operations-locale";
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
import type { AppLocale } from "@/lib/app-locale";
import { csrfHeaders } from "@/lib/csrf-client";
import { playAlertSound } from "@/lib/browser-alert-sound";
import {
  classifyFulfillmentForProduction,
  type FulfillmentProductionTiming,
} from "@/lib/fulfillment-time";
import { formatMoney } from "@/lib/money";
import { getOperationsErrorMessage } from "@/lib/messages/operations";
import { canTransitionOrderItem } from "@/lib/order-item-status";
import type { StaffOrderDto } from "@/lib/orders";
import { isCompletePickupCode, normalizePickupCode } from "@/lib/pickup-code";
import { hasPermission } from "@/lib/rbac";
import type { WorkModeDestination } from "@/lib/work-mode";

type OrderWithItems = StaffOrderDto;

export type StaffOrderEditLine = {
  kind: "EXISTING";
  key: string;
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  details: string;
} | {
  kind: "NEW";
  key: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
};

export type StaffOrderBoardControllerInput = {
  stall: { id: string; organizationId: string; slug: string; name: string; currency: string; timezone: string; businessDayCutoffHour: number };
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
  const { locale, t } = useOperationsLocale();
  const knownOrderIdsRef = useRef(new Set(initialOrders.map((order) => order.id)));
  const remindedPreorderIdsRef = useRef(new Set<string>());
  const alertsEnabledRef = useRef(false);
  const [orders, setOrders] = useState(initialOrders);
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [verifyingPickupOrderId, setVerifyingPickupOrderId] = useState<string | null>(null);
  const [pickupCheckoutOrderId, setPickupCheckoutOrderId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveConnection, setLiveConnection] = useState<StaffOrderLiveConnectionState>("connecting");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(initialNow);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<StaffOrderBoardViewMode>("TICKETS");
  const [composerOpen, setComposerOpen] = useState(false);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
  const [futureOrdersExpanded, setFutureOrdersExpanded] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [orderEditLines, setOrderEditLines] = useState<StaffOrderEditLine[]>([]);
  const [orderEditProductId, setOrderEditProductId] = useState("");
  const [orderEditBusy, setOrderEditBusy] = useState(false);
  const [orderEditMessage, setOrderEditMessage] = useState("");
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
    requiresAuthorizationCode: !hasPermission(account.role, "APPROVE_DISCOUNT"),
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
    onUnavailable: () => setMessage(t("staff.time.unavailable")),
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
    onInvalidTable: () => setMessage(t("staff.message.mergeOnlyTable")),
  });
  const reconcileCheckout = checkout.reconcile;
  const playConfiguredAlert = useCallback(() => {
    void playAlertSound({
      preset: modules.orderAlertSoundPreset ?? "URGENT",
      volume: modules.orderAlertVolume ?? 100,
      repeatCount: modules.orderAlertRepeatCount ?? 2,
      customUrl: modules.orderAlertSoundConfigured
        ? `/api/stalls/${encodeURIComponent(stall.slug)}/alert-sound`
        : null,
    });
  }, [
    modules.orderAlertRepeatCount,
    modules.orderAlertSoundConfigured,
    modules.orderAlertSoundPreset,
    modules.orderAlertVolume,
    stall.slug,
  ]);

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
      setMessage(error instanceof Error ? error.message : t("staff.configurationFallback"));
      return null;
    } finally {
      setPosConfigurationLoading(false);
    }
  }

  const notifyNewOrders = useCallback((count: number) => {
    if (!alertsEnabledRef.current) return;
    if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
    playConfiguredAlert();
    setMessage(t("staff.newOrders", { count }));
  }, [playConfiguredAlert, t]);

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
    if (next) playConfiguredAlert();
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
        ? t("staff.message.timeProposed")
        : t("staff.message.timeAccepted")
      );
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.time"));
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
      ? t("staff.message.createdOffline", { number: order.orderNo })
      : order.paymentStatus === "PAID"
        ? t("staff.message.createdPaid", { number: order.orderNo })
        : t("staff.message.createdUnpaid", { number: order.orderNo }));
  }

  async function openComposer() {
    setMessage("");
    const latest = await refreshPosConfiguration(true);
    const intake = prepareStaffOrderComposerIntake(posSnapshot, latest);
    if (!intake) return;
    setPosSnapshot(intake);
    setComposerOpen(true);
  }

  function toggleOrderDetails(orderId: string) {
    setExpandedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function canEditOrderContent(order: OrderWithItems) {
    return Boolean(
      orderCatalog
      && hasPermission(account.role, "UPDATE_ORDERS")
      && order.source === "STAFF_POS"
      && order.status === "CONFIRMED"
      && order.paymentStatus === "UNPAID"
      && order.items.every((item) => item.status === "PENDING"),
    );
  }

  function openOrderEditor(order: OrderWithItems) {
    if (!canEditOrderContent(order)) return;
    setEditingOrderId(order.id);
    setOrderEditMessage("");
    setOrderEditProductId("");
    setOrderEditLines(order.items.map((item) => ({
      kind: "EXISTING" as const,
      key: item.id,
      itemId: item.id,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      details: [
        formatStaffNoteOptions(locale, item.noteOptions, stall.currency),
        item.note ? t("staff.order.note", { note: item.note }) : "",
      ].filter(Boolean).join(" · "),
    })));
  }

  function changeOrderEditQuantity(key: string, delta: number) {
    setOrderEditLines((current) => current.map((line) => (
      line.key === key
        ? { ...line, quantity: Math.max(1, Math.min(100, line.quantity + delta)) }
        : line
    )));
  }

  function addOrderEditProduct() {
    const product = orderCatalog?.products.find((candidate) => candidate.id === orderEditProductId);
    if (!product) return;
    setOrderEditLines((current) => [...current, {
      kind: "NEW",
      key: `new-${crypto.randomUUID()}`,
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity: 1,
    }]);
    setOrderEditProductId("");
  }

  async function saveOrderEdit() {
    if (!editingOrderId || orderEditLines.length === 0) return;
    setOrderEditBusy(true);
    setOrderEditMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${editingOrderId}/content`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          items: orderEditLines.map((line) => line.kind === "EXISTING"
            ? { kind: "EXISTING", itemId: line.itemId, quantity: line.quantity }
            : {
                kind: "NEW",
                productId: line.productId,
                quantity: line.quantity,
                note: "",
                noteOptionIds: [],
                bundleChoiceIds: [],
              }),
        }),
      });
      const payload = await response.json() as {
        order?: OrderWithItems;
        code?: string;
      };
      if (!response.ok || !payload.order) {
        throw new Error(getOperationsErrorMessage(locale, payload.code, "staff.error.edit"));
      }
      knownOrderIdsRef.current.add(payload.order.id);
      setOrders((current) => current.map((order) => (
        order.id === payload.order!.id ? payload.order! : order
      )));
      setEditingOrderId(null);
      setOrderEditLines([]);
      setMessage(t("staff.message.editSaved", { number: payload.order.orderNo }));
    } catch (error) {
      setOrderEditMessage(error instanceof Error ? error.message : t("staff.error.network"));
    } finally {
      setOrderEditBusy(false);
    }
  }

  async function openCheckout(orderOrOrders: OrderWithItems | OrderWithItems[]) {
    const ordersToCheckout = Array.isArray(orderOrOrders) ? orderOrOrders : [orderOrOrders];
    const requiresPickupVerification = ordersToCheckout.find((order) => (
      order.fulfillmentType === "TAKEOUT"
      && order.source === "QR_MENU"
      && order.status === "READY"
      && !order.pickupVerifiedAt
    ));
    if (requiresPickupVerification) {
      setMessage("");
      setPickupCheckoutOrderId(requiresPickupVerification.id);
      return;
    }
    await openCheckoutDialog(ordersToCheckout);
  }

  async function openCheckoutDialog(ordersToCheckout: OrderWithItems[]) {
    setMessage("");
    const latest = await refreshPosConfiguration();
    const activeSnapshot = selectStaffOrderPosSnapshot(posSnapshot, latest);
    setPosSnapshot(activeSnapshot);
    checkout.open({
      orders: ordersToCheckout,
      modules: activeSnapshot.modules,
      paymentOptions: activeSnapshot.paymentOptions,
    });
  }

  async function completeSingleCheckout(
    order: OrderWithItems,
    checkoutRequest: StaffOrderCheckoutRequest,
  ) {
    const completed = await updateOrder(order.id, "COMPLETED", { checkout: checkoutRequest });
    if (completed && checkoutUsesCash(checkoutRequest)) notifyCashPaymentCompleted();
    return completed;
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
      setMessage(t("staff.message.mergeDone", { count: completedIds.size }));
      if (completedIds.size > 0 && checkoutUsesCash(checkoutRequest)) notifyCashPaymentCompleted();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
      return false;
    } finally {
      setUpdatingOrderId(null);
    }
  }

  function checkoutUsesCash(checkoutRequest: StaffOrderCheckoutRequest) {
    if (!modules.payment) return true;
    return paymentOptions.some((option) => (
      option.id === checkoutRequest.paymentOptionId && option.kind === "CASH"
    ));
  }

  function notifyCashPaymentCompleted() {
    window.dispatchEvent(new Event("stallorder:cash-payment-completed"));
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
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
      const verifiedOrder = order ? { ...order, ...pickup } : null;
      setOrders((current) => current.map((order) => (
        order.id === orderId ? {
          ...order,
          ...pickup,
        } : order
      )));
      setPickupCodes((current) => ({ ...current, [orderId]: "" }));
      if (pickupCheckoutOrderId === orderId && verifiedOrder) {
        setPickupCheckoutOrderId(null);
        await openCheckoutDialog([verifiedOrder]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
      if (pickupCheckoutOrderId === order.id) {
        setPickupCheckoutOrderId(null);
        await openCheckoutDialog([{ ...order, ...pickup }]);
      }
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
        setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
  }, [applyOrderSnapshot, loadOrderSnapshot, stall.id, stall.slug, t]);

  const filteredOrders = useMemo(
    () => filterStaffOrders(orders, query, locale),
    [locale, orders, query],
  );
  const orderProductionTimings = useMemo(() => new Map(orders.map((order) => [
    order.id,
    classifyFulfillmentForProduction(order, {
      timeZone: stall.timezone,
      businessDayCutoffHour: stall.businessDayCutoffHour,
      now: new Date(now),
    }),
  ])), [now, orders, stall.businessDayCutoffHour, stall.timezone]);
  const futureOrders = useMemo(() => filteredOrders.filter((order) => (
    isFutureProductionOrder(order, orderProductionTimings.get(order.id))
  )), [filteredOrders, orderProductionTimings]);
  const operationalOrders = useMemo(() => filteredOrders.filter((order) => (
    !isFutureProductionOrder(order, orderProductionTimings.get(order.id))
  )), [filteredOrders, orderProductionTimings]);
  const reminderOrderIds = useMemo(() => new Set(orders.flatMap((order) => {
    const timing = orderProductionTimings.get(order.id);
    const fulfillmentAt = timing?.effectiveFulfillmentAt?.getTime();
    if (!fulfillmentAt
      || order.status === "WAITING_CONFIRMATION"
      || fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)
      || order.items.every((item) => item.status === "SERVED")) return [];
    const leadMilliseconds = (modules.preorderReminderMinutes ?? 30) * 60_000;
    return now >= fulfillmentAt - leadMilliseconds ? [order.id] : [];
  })), [modules.preorderReminderMinutes, now, orderProductionTimings, orders]);
  useEffect(() => {
    for (const orderId of remindedPreorderIdsRef.current) {
      if (!reminderOrderIds.has(orderId)) remindedPreorderIdsRef.current.delete(orderId);
    }
    const newlyDue = [...reminderOrderIds].filter((orderId) => !remindedPreorderIdsRef.current.has(orderId));
    newlyDue.forEach((orderId) => remindedPreorderIdsRef.current.add(orderId));
    if (newlyDue.length === 0 || !alertsEnabledRef.current) return;
    if ("vibrate" in navigator) navigator.vibrate([240, 100, 240, 100, 400]);
    playConfiguredAlert();
    setMessage(t("staff.preorder.reminder", { count: newlyDue.length }));
  }, [playConfiguredAlert, reminderOrderIds, t]);
  const futureUnpaidTotal = futureOrders.reduce((sum, order) => (
    sum + (order.paymentStatus === "UNPAID" ? order.total : 0)
  ), 0);
  const orderEditProducts = useMemo(() => (orderCatalog?.products ?? []).filter((product) => (
    product.noteGroups.every((group) => group.minSelections === 0)
    && (product.bundleChoiceGroups ?? []).every((group) => group.minSelections === 0)
  )), [orderCatalog]);
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
    () => selectStaffOrderKitchenGroups(operationalOrders, locale),
    [locale, operationalOrders],
  );
  const diningTableGroups = useMemo(
    () => selectStaffOrderDiningTableGroups(
      operationalOrders,
      locale,
      t("staff.table.unassigned"),
    ),
    [locale, operationalOrders, t],
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
    filteredOrders: operationalOrders,
    futureOrders,
    futureOrdersExpanded,
    futureUnpaidTotal,
    orderProductionTimings,
    reminderOrderIds,
    expandedOrderIds,
    orders,
    selectedItems,
    canUpdateSelection,
    nextSelectedStatus,
    kitchenGroups,
    diningTableGroups,
    selectedItemIds,
    pickupCodes,
    pickupCheckoutOrderId,
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
    orderEditor: {
      editingOrder: editingOrderId
        ? orders.find((order) => order.id === editingOrderId) ?? null
        : null,
      lines: orderEditLines,
      products: orderEditProducts,
      selectedProductId: orderEditProductId,
      busy: orderEditBusy,
      message: orderEditMessage,
      editableOrderIds: new Set(operationalOrders.filter(canEditOrderContent).map((order) => order.id)),
    },
    actions: {
      onClearSelectedItems: clearSelectedItems,
      onCloseComposer: () => setComposerOpen(false),
      onClosePickupCheckout: () => {
        setPickupCheckoutOrderId(null);
        setPickupCodes((current) => {
          if (!pickupCheckoutOrderId) return current;
          const next = { ...current };
          delete next[pickupCheckoutOrderId];
          return next;
        });
      },
      onCompletePaidOrders: completePaidOrders,
      onCreated: handleStaffOrderCreated,
      onAddOrderEditProduct: addOrderEditProduct,
      onChangeOrderEditProduct: setOrderEditProductId,
      onChangeOrderEditQuantity: changeOrderEditQuantity,
      onCloseOrderEditor: () => setEditingOrderId(null),
      onOpenCheckout: openCheckout,
      onOpenComposer: openComposer,
      onOpenOrderEditor: openOrderEditor,
      onPickupCodeChange: handlePickupCodeChange,
      onPrintOrder: printOrder,
      onQueryChange: setQuery,
      onRefresh: () => void refreshOrders(),
      onRemoveOrderEditLine: (key) => setOrderEditLines((current) => (
        current.filter((line) => line.key !== key)
      )),
      onSaveOrderEdit: saveOrderEdit,
      onSynchronized: () => void refreshStaffOrdersAfterOfflineSync(refreshOrders),
      onToggleAlerts: toggleAlerts,
      onToggleFutureOrders: () => setFutureOrdersExpanded((current) => !current),
      onToggleOrderDetails: toggleOrderDetails,
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

function isFutureProductionOrder(
  order: OrderWithItems,
  timing: FulfillmentProductionTiming | undefined,
) {
  return Boolean(
    timing?.fulfillmentBusinessDate
    && timing.fulfillmentBusinessDate > timing.currentBusinessDate
    && order.status === "CONFIRMED"
    && !fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)
  );
}

function formatStaffNoteOptions(
  locale: AppLocale,
  noteOptions: Array<{ groupName: string; optionName: string; priceDelta: number }>,
  currency: string,
) {
  const usesCjkPunctuation = locale === "zh-TW" || locale === "ja";
  const pairSeparator = usesCjkPunctuation ? "：" : ": ";
  const optionSeparator = usesCjkPunctuation ? "、" : ", ";
  return noteOptions.map((option) => {
    const price = option.priceDelta !== 0
      ? ` (${option.priceDelta > 0 ? "+" : ""}${formatMoney(option.priceDelta, currency, locale)})`
      : "";
    return `${option.groupName}${pairSeparator}${option.optionName}${price}`;
  }).join(optionSeparator);
}
