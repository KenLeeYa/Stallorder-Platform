"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CancellationReason, OrderItemStatus, OrderStatus, PaymentOptionKind, UserRole } from "@prisma/client";
import Link from "next/link";
import { CheckCheck, CheckCircle2, ChefHat, ChevronDown, ChevronUp, Clock3, KeyRound, ListChecks, LoaderCircle, MapPinned, Minus, PackageCheck, Pencil, Play, Plus, Printer, RefreshCw, Search, ShoppingCart, TriangleAlert, Truck, Undo2, Volume2, VolumeX, WalletCards, Wifi, WifiOff, X } from "lucide-react";
import { FulfillmentTimePicker } from "@/components/fulfillment-time-picker";
import { useOperationsLocale } from "@/components/operations-locale";
import { LogoutButton } from "@/components/logout-button";
import { OfflineBootstrapControl } from "@/components/offline-bootstrap-control";
import { OfflineQueueStatus } from "@/components/offline-queue-status";
import { PwaControls } from "@/components/pwa-controls";
import { StaffOrderComposer } from "@/components/staff-order-composer";
import { StaffDiscountSelector } from "@/components/staff-discount-selector";
import { StaffCapacityControl } from "@/components/staff-capacity-control";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import type { StaffCapacityData } from "@/lib/capacity-contract";
import type { AppLocale } from "@/lib/app-locale";
import { csrfHeaders } from "@/lib/csrf-client";
import { buildFulfillmentTimeSlots } from "@/lib/fulfillment-time-options";
import { classifyFulfillmentForProduction, type FulfillmentProductionTiming } from "@/lib/fulfillment-time";
import { formatMoney } from "@/lib/money";
import { formatAppDateTime } from "@/lib/locale-format";
import { getOperationsErrorMessage } from "@/lib/messages/operations";
import { canTransitionOrderItem } from "@/lib/order-item-status";
import { staffStatusOptions, type StaffOrderDto } from "@/lib/orders";
import { isCompletePickupCode, normalizePickupCode } from "@/lib/pickup-code";
import { canTransitionOrder, hasPermission } from "@/lib/rbac";
import { getStaffCheckoutPreview } from "@/lib/staff-discount-presentation";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";
import type { WorkModeDestination } from "@/lib/work-mode";

type OrderWithItems = StaffOrderDto;

type Props = {
  stall: { id: string; organizationId: string; slug: string; name: string; currency: string; timezone: string; businessDayCutoffHour: number };
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
type PendingTimeProposal = {
  orderId: string;
  orderNo: string;
  version: number;
  proposedFulfillmentAt: string;
  reason: string;
};
type OrderEditLine = {
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

const staffFunctionTileClass = "inline-grid h-11 w-11 shrink-0 place-items-center rounded-md";
const staffFunctionIconClass = "h-5 w-5";
type OperationsTranslator = ReturnType<typeof useOperationsLocale>["t"];
const cancellationReasons: CancellationReason[] = ["SOLD_OUT", "CUSTOMER_CANCELLED", "WAIT_TOO_LONG", "DUPLICATE_ORDER", "OTHER"];

function formatStaffNoteOptions(
  locale: AppLocale,
  noteOptions: Array<{ groupName: string; optionName: string; priceDelta: number }>,
  currency: string,
  includePrice: boolean,
) {
  const usesCjkPunctuation = locale === "zh-TW" || locale === "ja";
  const pairSeparator = usesCjkPunctuation ? "：" : ": ";
  const optionSeparator = usesCjkPunctuation ? "、" : ", ";
  return noteOptions.map((option) => {
    const price = includePrice && option.priceDelta !== 0
      ? ` (${option.priceDelta > 0 ? "+" : ""}${formatMoney(option.priceDelta, currency, locale)})`
      : "";
    return `${option.groupName}${pairSeparator}${option.optionName}${price}`;
  }).join(optionSeparator);
}

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
  const { locale, t } = useOperationsLocale();
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
  const [pendingTimeProposal, setPendingTimeProposal] = useState<PendingTimeProposal | null>(null);
  const [checkoutOrders, setCheckoutOrders] = useState<OrderWithItems[]>([]);
  const [selectedPaymentOptionId, setSelectedPaymentOptionId] = useState<string | null>(null);
  const [selectedDiscountOptionId, setSelectedDiscountOptionId] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [discountApprovalReason, setDiscountApprovalReason] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [message, setMessage] = useState("");
  const [cashShiftRequired, setCashShiftRequired] = useState(false);
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
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
  const [futureOrdersExpanded, setFutureOrdersExpanded] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [orderEditLines, setOrderEditLines] = useState<OrderEditLine[]>([]);
  const [orderEditProductId, setOrderEditProductId] = useState("");
  const [orderEditBusy, setOrderEditBusy] = useState(false);
  const [orderEditMessage, setOrderEditMessage] = useState("");
  const fulfillmentTimeSlots = useMemo(() => buildFulfillmentTimeSlots(
    orderCatalog?.fulfillmentSlots ?? [],
    stall.timezone,
  ), [orderCatalog?.fulfillmentSlots, stall.timezone]);
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
      const payload = await response.json() as PosConfiguration & { code?: string };
      if (!response.ok) throw new Error(getOperationsErrorMessage(locale, payload.code, "staff.configurationFailed"));
      setModules(payload.modules);
      setPaymentOptions(payload.paymentOptions);
      setDiscountOptions(payload.discountOptions);
      if (payload.catalog) setOrderCatalog(payload.catalog);
      return payload;
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
    playNotificationTone();
    setMessage(t("staff.newOrders", { count }));
  }, [t]);

  const refreshOrders = useCallback(async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true);
      setMessage("");
    }
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/orders`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(t("staff.error.updateOrder"));
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
        setMessage(error instanceof Error ? error.message : t("staff.error.network"));
      }
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, [notifyNewOrders, stall.id, stall.slug, t]);

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
    setCashShiftRequired(false);
    setUpdatingOrderId(orderId);
    try {
      const currentOrder = orders.find((order) => order.id === orderId);
      if (currentOrder?.source === "OFFLINE_POS") {
        const nextState = status === "COMPLETED"
          ? "LOCAL_COMPLETED"
          : status === "CANCELLED" ? "LOCAL_CANCELLED" : null;
        if (!nextState) throw new Error(t("staff.error.updateOrder"));
        const [{ transitionOfflineOrder }, { offlineOrderToStaffOrder }] = await Promise.all([
          import("@/offline/offline-operations"),
          import("@/offline/offline-staff-order"),
        ]);
        const updated = await transitionOfflineOrder(
          orderId,
          nextState,
          status === "CANCELLED"
            ? [options.cancellationReason, options.cancellationDetail].filter(Boolean).join(": ") || t("staff.cancel.confirm")
            : null,
        );
        const staffOrder = offlineOrderToStaffOrder(updated);
        setOrders((current) => (
          status === "COMPLETED" || status === "CANCELLED"
            ? current.filter((order) => order.id !== orderId)
            : current.map((order) => order.id === orderId ? staffOrder : order)
        ));
        setMessage(status === "COMPLETED"
          ? t("staff.message.offlineCompleted")
          : t("staff.message.offlineCancelled"));
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
      const payload = await response.json() as { order: OrderWithItems; code?: string };
      if (!response.ok) {
        setCashShiftRequired(payload.code === "ACTIVE_SHIFT_REQUIRED");
        throw new Error(getOperationsErrorMessage(locale, payload.code, "staff.error.updateOrder"));
      }
      setOrders((current) =>
        status === "COMPLETED" || status === "CANCELLED"
          ? current.filter((order) => order.id !== orderId)
          : current.map((order) => (order.id === orderId ? payload.order : order)),
      );
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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

  async function updateFulfillmentTime(
    order: OrderWithItems,
    command: { operation: "CONFIRM_REQUESTED"; version: number } | {
      operation: "PROPOSE";
      version: number;
      proposedFulfillmentAt: string;
      reason: string;
    },
  ) {
    setMessage("");
    setUpdatingOrderId(order.id);
    try {
      const response = await fetch(
        `/api/stalls/${stall.slug}/orders/${order.id}/fulfillment-time`,
        {
          method: "PATCH",
          headers: csrfHeaders(),
          body: JSON.stringify(command),
        },
      );
      const payload = await response.json() as { order?: OrderWithItems; error?: string };
      if (!response.ok || !payload.order) {
        throw new Error(t("staff.error.time"));
      }
      setOrders((current) => current.map((candidate) => (
        candidate.id === order.id ? payload.order! : candidate
      )));
      setPendingTimeProposal(null);
      setMessage(command.operation === "PROPOSE"
        ? t("staff.message.timeProposed")
        : t("staff.message.timeAccepted")
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.time"));
    } finally {
      setUpdatingOrderId(null);
    }
  }

  function openTimeProposal(order: OrderWithItems) {
    const slots = fulfillmentTimeSlots;
    if (slots.length === 0) {
      setMessage(t("staff.error.noSlots"));
      return;
    }
    const preferred = slots.find((slot) => slot.iso !== order.requestedFulfillmentAt)?.iso ?? slots[0]!.iso;
    setPendingTimeProposal({
      orderId: order.id,
      orderNo: order.orderNo,
      version: order.fulfillmentTimeVersion,
      proposedFulfillmentAt: preferred,
      reason: t("staff.time.defaultReason"),
    });
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
      if (!response.ok) throw new Error(t("staff.error.updateItem"));
      setOrders((current) => current.map((order) => (
        order.id === orderId ? payload.order : order
      )));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
          ? t("staff.message.offlineCompleted")
          : t("staff.message.offlineSaved"));
        return;
      }
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}/items`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(t("staff.error.batch"));
      setOrders((current) => current.map((order) => (
        order.id === orderId ? payload.order : order
      )));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
      if (!response.ok) throw new Error(t("staff.error.batch"));
      replaceOrders(payload.orders as OrderWithItems[]);
      setSelectedItemIds(new Set());
      setUndoBatch({
        actionId: payload.actionId,
        undoExpiresAt: payload.undoExpiresAt,
        itemCount: payload.itemCount,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
      if (!response.ok) throw new Error(t("staff.error.batch"));
      replaceOrders(payload.orders as OrderWithItems[]);
      setUndoBatch(null);
      setMessage(t("staff.message.undoDone"));
    } catch (error) {
      setUndoBatch(null);
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
      ? t("staff.message.createdOffline", { number: order.orderNo })
      : order.paymentStatus === "PAID"
      ? t("staff.message.createdPaid", { number: order.orderNo })
      : t("staff.message.createdUnpaid", { number: order.orderNo }));
  }

  async function openComposer() {
    setMessage("");
    const latest = await refreshPosConfiguration(true);
    if (!latest?.catalog && !orderCatalog) return;
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
        formatStaffNoteOptions(locale, item.noteOptions, stall.currency, false),
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
      const payload = await response.json() as { order?: OrderWithItems; error?: string };
      if (!response.ok || !payload.order) throw new Error(t("staff.error.edit"));
      replaceOrders([payload.order]);
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
      discountOptionId: modules.discount && checkoutDiscountEligibleSubtotal > 0
        ? selectedDiscountOptionId
        : null,
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
      setMessage(t("staff.message.mergeOnlyTable"));
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
      if (!response.ok) throw new Error(t("staff.error.updateOrder"));
      const completedIds = new Set<string>(payload.orderIds ?? []);
      setOrders((current) => current.filter((order) => !completedIds.has(order.id)));
      setCheckoutOrders([]);
      setMessage(t("staff.message.mergeDone", { count: completedIds.size }));
    } catch (error) {
      setManagerPassword("");
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
        setMessage(t("staff.message.printOffline"));
        return;
      }
      const response = await fetch(`/api/stalls/${stall.slug}/print-jobs`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "QUEUE", orderId }),
      });
      if (!response.ok) throw new Error(t("common.apiError"));
      setMessage(t("staff.message.printQueued"));
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
      const response = await fetch(`/api/stalls/${stall.slug}/orders/${orderId}/verify-pickup`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ mode: "CODE", code }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(t("common.apiError"));
      setOrders((current) => current.map((order) => (
        order.id === orderId ? {
          ...order,
          pickupVerifiedAt: payload.pickupVerifiedAt,
          pickupVerificationMethod: payload.pickupVerificationMethod,
        } : order
      )));
      setPickupCodes((current) => ({ ...current, [orderId]: "" }));
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
      if (!response.ok) throw new Error(t("common.apiError"));
      setOrders((current) => current.map((candidate) => (
        candidate.id === order.id ? {
          ...candidate,
          pickupVerifiedAt: payload.pickupVerifiedAt,
          pickupVerificationMethod: payload.pickupVerificationMethod,
        } : candidate
      )));
      setPendingManualPickup(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
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
  const orderProductionTimings = useMemo(() => new Map(filteredOrders.map((order) => [
    order.id,
    classifyFulfillmentForProduction(order, {
      timeZone: stall.timezone,
      businessDayCutoffHour: stall.businessDayCutoffHour,
      now: new Date(now),
    }),
  ])), [filteredOrders, now, stall.businessDayCutoffHour, stall.timezone]);
  const futureOrders = useMemo(() => filteredOrders.filter((order) => {
    const timing = orderProductionTimings.get(order.id);
    return Boolean(
      timing?.fulfillmentBusinessDate
      && timing.fulfillmentBusinessDate > timing.currentBusinessDate
      && order.status === "CONFIRMED"
      && !fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)
    );
  }), [filteredOrders, orderProductionTimings]);
  const operationalOrders = useMemo(() => filteredOrders.filter((order) => {
    const timing = orderProductionTimings.get(order.id);
    return !(
      timing?.fulfillmentBusinessDate
      && timing.fulfillmentBusinessDate > timing.currentBusinessDate
      && order.status === "CONFIRMED"
      && !fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)
    );
  }), [filteredOrders, orderProductionTimings]);
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
    for (const order of operationalOrders) {
      if (order.source === "OFFLINE_POS") continue;
      for (const item of order.items) {
        if (item.status === "SERVED") continue;
        const notes = [
          formatStaffNoteOptions(locale, item.noteOptions, stall.currency, false),
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
  }, [locale, operationalOrders, stall.currency]);
  const diningTableGroups = useMemo(() => {
    const groups = new Map<string, { diningTableId: string; tableLabel: string; orders: OrderWithItems[] }>();
    for (const order of operationalOrders) {
      if (order.fulfillmentType !== "DINE_IN" || !order.diningTableId) continue;
      const current = groups.get(order.diningTableId) ?? {
        diningTableId: order.diningTableId,
        tableLabel: order.tableLabel ?? t("staff.table.unassigned"),
        orders: [],
      };
      current.orders.push(order);
      groups.set(order.diningTableId, current);
    }
    return [...groups.values()].sort((left, right) => left.tableLabel.localeCompare(right.tableLabel, locale));
  }, [locale, operationalOrders, t]);

  const checkoutDiscountEligibleSubtotal = checkoutOrders.reduce((orderSum, order) => (
    orderSum + order.items.reduce((itemSum, item) => (
      itemSum + (item.isOrderDiscountEligible ? item.unitPrice * item.quantity : 0)
    ), 0)
  ), 0);
  const checkoutDiscount = checkoutDiscountEligibleSubtotal > 0
    ? discountOptions.find((option) => option.id === selectedDiscountOptionId) ?? null
    : null;
  const checkoutPreview = getStaffCheckoutPreview(checkoutOrders.map((order) => ({
    ...order,
    discountEligibleSubtotal: order.items.reduce((sum, item) => (
      sum + (item.isOrderDiscountEligible ? item.unitPrice * item.quantity : 0)
    ), 0),
  })), checkoutDiscount);
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
  const timeProposalOrder = pendingTimeProposal
    ? orders.find((order) => order.id === pendingTimeProposal.orderId) ?? null
    : null;
  const editingOrder = editingOrderId
    ? orders.find((order) => order.id === editingOrderId) ?? null
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-3 md:px-8 md:py-5">
      <div className="flex min-w-0 max-w-full items-start justify-between gap-3 print:hidden sm:gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-teal-800">{t("staff.mobileBoard")}</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">{stall.name}</h1>
          <p className="mt-1 text-xs text-stone-500">{account.displayName} · {roleLabel(account.role, t)}</p>
        </div>
        <WorkModeSwitcher
          destinations={workModeDestinations}
          currentMode="STAFF"
          organizationId={stall.organizationId}
          stallId={stall.id}
          offlineGuardStallId={stall.id}
          compactOnMobile
          className="w-[min(52vw,220px)] shrink-0"
        />
      </div>
      <nav aria-label={t("staff.functions")} data-testid="staff-function-grid" className="relative mt-3 flex w-full min-w-0 items-center gap-2 overflow-x-auto border-y border-stone-200 py-2 print:hidden sm:overflow-x-visible [&>*]:shrink-0">
        <div data-testid="staff-function-status-group" className="flex items-center gap-1 border-r border-stone-200 pr-2 [&_button]:h-11 [&_button]:w-11 [&_span[title]]:h-11 [&_span[title]]:w-11 [&_span[title]]:justify-center [&_span[title]]:px-0">
          <LiveConnectionBadge state={liveConnection} t={t} />
          <div className="shrink-0">
            <PwaControls showWakeLock />
          </div>
        </div>
        <div data-testid="staff-function-order-group" className="flex items-center gap-2 border-r border-stone-200 pr-2">
            {orderCatalog && hasPermission(account.role, "CREATE_ORDERS") ? (
              <button type="button" title={t("staff.action.createOrder")} disabled={posConfigurationLoading} onClick={() => void openComposer()} className={`${staffFunctionTileClass} bg-teal-800 text-white disabled:cursor-wait disabled:opacity-60`}>
                <ShoppingCart className={staffFunctionIconClass} />
                <span className="sr-only">{t("staff.action.createOrder")}</span>
              </button>
            ) : null}
            {modules.dineIn ? (
              <Link href={`/staff/${stall.slug}/floor`} title={t("staff.action.floor")} className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700`}>
                <MapPinned className={staffFunctionIconClass} />
                <span className="sr-only">{t("staff.action.floor")}</span>
              </Link>
            ) : null}
            {modules.print && hasPermission(account.role, "MANAGE_PRINT_QUEUE") ? (
              <Link href={`/staff/${stall.slug}/print`} title={t("staff.action.printQueue")} className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700`}>
                <Printer className={staffFunctionIconClass} />
                <span className="sr-only">{t("staff.action.printQueue")}</span>
              </Link>
            ) : null}
            {hasPermission(account.role, "MANAGE_CASH_SHIFT") ? (
              <Link href={`/staff/${stall.slug}/cash`} title={t("staff.action.cashShift")} className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700`}>
                <WalletCards className={staffFunctionIconClass} />
                <span className="sr-only">{t("staff.action.cashShift")}</span>
              </Link>
            ) : null}
            {capacity ? <StaffCapacityControl stallSlug={stall.slug} initialData={capacity} compact /> : null}
        </div>
        <div data-testid="staff-function-device-group" className="flex items-center gap-2">
            <button type="button" role="switch" aria-checked={alertsEnabled} aria-label={alertsEnabled ? t("staff.action.notificationsOn") : t("staff.action.notificationsOff")} onClick={toggleAlerts} title={alertsEnabled ? t("staff.action.notificationsDisable") : t("staff.action.notificationsEnable")} className={`${staffFunctionTileClass} border ${alertsEnabled ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600"}`}>
              {alertsEnabled ? <Volume2 className={staffFunctionIconClass} /> : <VolumeX className={staffFunctionIconClass} />}
              <span aria-hidden="true" className="sr-only">{t("staff.action.notifications")}</span>
            </button>
            <div data-testid="staff-function-offline" className={`${staffFunctionTileClass} relative border border-stone-300 bg-white text-stone-700 [&>div>button:first-child]:h-11 [&>div>button:first-child]:w-11 [&>div>button:first-child]:border-0`}>
              <OfflineBootstrapControl
                stallId={stall.id}
                stallSlug={stall.slug}
                appVersion={appVersion}
              />
              <span className="sr-only">{t("staff.action.offlineDevice")}</span>
            </div>
            <button type="button" onClick={() => void refreshOrders()} title={t("common.refresh")} className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700`}>
              <RefreshCw className={`${staffFunctionIconClass} ${isRefreshing ? "animate-spin" : ""}`} />
              <span className="sr-only">{t("common.refresh")}</span>
            </button>
            <div data-testid="staff-function-logout" className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700 [&>button]:h-11 [&>button]:w-11 [&>button]:border-0`}>
              <LogoutButton offlineStallId={stall.id} />
              <span className="sr-only">{t("staff.action.logout")}</span>
            </div>
        </div>
      </nav>
      <OfflineQueueStatus
        stallId={stall.id}
        stallSlug={stall.slug}
        onSynchronized={() => void refreshOrders(true)}
      />
      {message ? <p role="status" className="mt-4 text-sm text-stone-700 print:hidden">{message}</p> : null}
      <div className="mt-4 flex flex-col gap-2 sm:mt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 print:hidden">
        <label className="relative block w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
          <span className="sr-only">{t("staff.search.label")}</span>
          <input type="search" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder={t("staff.search.shortPlaceholder")} className="h-11 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-sm" />
        </label>
        {account.role === "KITCHEN" ? (
          <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label={t("staff.view.kitchenMode")}>
            <button type="button" aria-pressed={viewMode === "TICKETS"} onClick={() => setViewMode("TICKETS")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TICKETS" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("staff.view.ticket")}</button>
            <button type="button" aria-pressed={viewMode === "SUMMARY"} onClick={() => setViewMode("SUMMARY")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "SUMMARY" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("staff.view.itemSummary")}</button>
          </div>
        ) : modules.dineIn ? (
          <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label={t("staff.view.orderMode")}>
            <button type="button" aria-pressed={viewMode === "TICKETS"} onClick={() => setViewMode("TICKETS")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TICKETS" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("staff.view.individual")}</button>
            <button type="button" aria-pressed={viewMode === "TABLES"} onClick={() => setViewMode("TABLES")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TABLES" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("staff.view.combineTable")}</button>
          </div>
        ) : null}
      </div>

      {selectedItems.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-stone-200 bg-stone-50 px-3 py-3 print:hidden">
          <span className="text-sm font-semibold">{t("staff.selection.count", { count: selectedItems.length })}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelectedItemIds(new Set())} className="h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold">{t("staff.selection.clear")}</button>
            <button type="button" disabled={!canUpdateSelection || batchBusy || !nextSelectedStatus} onClick={() => nextSelectedStatus && void updateSelectedItems(selectedItems.map((item) => item.id), nextSelectedStatus)} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><ListChecks className="h-4 w-4" />{nextSelectedStatus ? t("staff.selection.batch", { action: batchActionLabel(nextSelectedStatus, t) }) : t("staff.selection.sameStatus")}</button>
          </div>
        </div>
      ) : null}

      {undoBatch ? (
        <div role="status" className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 print:hidden">
          <span>{t("staff.selection.updated", { count: undoBatch.itemCount })}</span>
          <button type="button" disabled={batchBusy} onClick={() => void undoSelectedItems()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-amber-700 px-3 text-xs font-semibold"><Undo2 className="h-4 w-4" />{t("staff.selection.undo")}</button>
        </div>
      ) : null}

      {account.role === "KITCHEN" && viewMode === "SUMMARY" ? (
        <div className="mt-6 divide-y divide-stone-200 border-y border-stone-200 print:hidden">
          {kitchenGroups.map((group) => {
            const nextStatus = nextOperationalItemStatus(group.status);
            const canUpdate = nextStatus && canTransitionOrderItem(group.status, nextStatus, account.role);
            return <article key={group.key} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><ChefHat className="h-4 w-4 text-teal-700" /><h2 className="font-semibold">{group.quantity} × {group.name}</h2><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{orderItemStatusLabel(group.status, t)}</span></div>{group.notes ? <p className="mt-1 text-xs text-teal-800">{group.notes}</p> : null}<p className="mt-2 text-xs text-stone-500">{t("staff.item.source", { orders: group.tickets.join(", ") })}</p></div>{canUpdate && nextStatus ? <button type="button" disabled={batchBusy} onClick={() => void updateSelectedItems(group.itemIds, nextStatus)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><ListChecks className="h-4 w-4" />{t("staff.item.all", { action: batchActionLabel(nextStatus, t) })}</button> : null}</article>;
          })}
          {kitchenGroups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{t("staff.item.nonePending")}</p> : null}
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
                  <div><h2 className="text-lg font-semibold">{group.tableLabel}</h2><p className="mt-1 text-xs text-stone-500">{t("staff.table.summary", { orders: group.orders.length, items: group.orders.reduce((sum, order) => sum + order.items.reduce((count, item) => count + item.quantity, 0), 0) })}</p></div>
                  <strong>{formatMoney(group.orders.reduce((sum, order) => sum + order.total, 0), stall.currency, locale)}</strong>
                </div>
                <div className="mt-4 divide-y divide-stone-100 border-y border-stone-200">{group.orders.map((order) => <div key={order.id} className="py-3"><div className="flex items-center justify-between gap-3 text-sm"><strong>{t("staff.order.number", { number: order.orderNo })}</strong><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{contextualOrderStatusLabel(order, t)}</span></div><p className="mt-1 text-xs text-stone-600">{order.items.map((item) => `${item.quantity}×${item.name}`).join(", ")}</p><p className="mt-1 text-xs text-stone-500">{paymentStatusLabel(order.paymentStatus, t)}</p></div>)}</div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className={`text-xs font-semibold ${pendingItems === 0 ? "text-emerald-700" : "text-amber-800"}`}>{pendingItems === 0 ? t("staff.table.allServed") : t("staff.table.pendingItems", { count: pendingItems })}</span>
                  <button type="button" disabled={!checkoutEligible || updatingOrderId !== null || posConfigurationLoading} onClick={() => unpaidOrders.length > 0 ? void openCheckout(unpaidOrders) : void completePaidOrders(group.orders)} className="h-10 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{unpaidOrders.length > 0 ? unpaidOrders.length > 1 ? t("staff.table.mergeCheckout", { count: unpaidOrders.length }) : t("staff.table.completeCheckout") : t("staff.table.complete")}</button>
                </div>
              </article>
            );
          })}
          {diningTableGroups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500 md:col-span-2">{t("staff.table.empty")}</p> : null}
        </div>
      ) : (
      <div className="mt-6 grid gap-4 md:grid-cols-2 print:block">
        <div className="md:col-span-2 print:hidden">
          <h2 className="text-lg font-semibold">{t("staff.today.title")}</h2>
          <p className="mt-1 text-xs text-stone-500">{t("staff.today.description")}</p>
        </div>
        {operationalOrders.map((order) => (
          <article
            key={order.id}
            className={`rounded-lg border p-4 ${orderAgeClasses(order, orderProductionTimings.get(order.id), now)}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-stone-500"><span>{t("staff.order.number", { number: order.orderNo })}</span>{order.isTest ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">{t("staff.order.test")}</span> : null}{order.source === "OFFLINE_POS" ? <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-900">{t("staff.order.localPending")}</span> : null}</div>
                <h2 className="mt-1 font-semibold">{order.customerName}</h2>
            <p className="mt-1 text-sm text-stone-500">{orderTimingSummary(order, orderProductionTimings.get(order.id), now, stall.timezone, locale, t)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">{contextualOrderStatusLabel(order, t)}</span>
                <button type="button" aria-expanded={expandedOrderIds.has(order.id)} aria-controls={`order-details-${order.id}`} onClick={() => toggleOrderDetails(order.id)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-stone-300 px-2 text-xs font-semibold print:hidden">
                  {expandedOrderIds.has(order.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {expandedOrderIds.has(order.id) ? t("staff.order.collapseShort") : t("staff.order.viewDetails")}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3 print:hidden">
              <p className="text-sm text-stone-600">{t("common.portions", { count: order.items.reduce((sum, item) => sum + item.quantity, 0) })} · <strong className="text-stone-950">{formatMoney(order.total, stall.currency, locale)}</strong> · {paymentStatusLabel(order.paymentStatus, t)}</p>
              <div className="flex flex-wrap gap-2">
                {canEditOrderContent(order) ? <button type="button" onClick={() => openOrderEditor(order)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-stone-300 px-3 text-xs font-semibold"><Pencil className="h-4 w-4" />{t("staff.order.edit")}</button> : null}
                {order.status === "READY" && order.paymentStatus === "UNPAID" && hasPermission(account.role, "CHECKOUT_ORDERS") && (order.fulfillmentType !== "DINE_IN" || order.items.every((item) => item.status === "SERVED")) ? <button type="button" disabled={updatingOrderId === order.id || posConfigurationLoading} onClick={() => void openCheckout(order)} className="inline-flex min-h-9 items-center gap-1 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50"><WalletCards className="h-4 w-4" />{t("staff.order.checkoutForCustomer")}</button> : null}
              </div>
            </div>
            {expandedOrderIds.has(order.id) ? <div id={`order-details-${order.id}`}>
            {order.fulfillmentType === "DELIVERY" ? (
              <div className="mt-3 flex items-start gap-2 border-y border-stone-200 bg-stone-50 px-3 py-3 text-sm">
                <Truck className="mt-0.5 h-4 w-4 shrink-0 text-teal-800" />
                <div className="min-w-0"><p className="font-medium break-words">{order.deliveryAddress || t("staff.delivery.noAddress")}</p>{order.customerPhone ? <p className="mt-1 text-stone-600">{order.customerPhone}</p> : <p className="mt-1 text-stone-500">{t("staff.delivery.noPhone")}</p>}</div>
              </div>
            ) : null}
            {order.fulfillmentType !== "DINE_IN" && order.fulfillmentTimeState !== "NOT_REQUESTED" ? (
              <div className={`mt-3 rounded-md border px-3 py-3 text-sm ${order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? "border-amber-300 bg-amber-50 text-amber-950" : order.fulfillmentTimeState === "DECLINED" || order.fulfillmentTimeState === "EXPIRED" ? "border-red-200 bg-red-50 text-red-900" : "border-teal-200 bg-teal-50 text-teal-950"}`}>
                <div className="flex items-start gap-2">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{fulfillmentTimeTitle(order, locale, t)}</p>
                    {order.fulfillmentTimeChangeReason ? <p className="mt-1 text-xs">{t("staff.order.reason", { reason: order.fulfillmentTimeChangeReason })}</p> : null}
                    {order.fulfillmentTimeResponseExpiresAt && order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? <p className="mt-1 text-xs">{t("staff.order.replyBy", { time: formatStaffFulfillmentTime(order.fulfillmentTimeResponseExpiresAt, locale) })}</p> : null}
                  </div>
                </div>
                {order.source !== "OFFLINE_POS" && ["WAITING_CONFIRMATION", "CONFIRMED"].includes(order.status) ? (
                  <div className="mt-3 flex flex-wrap gap-2 print:hidden">
                    {order.fulfillmentTimeState === "REQUESTED" ? <button type="button" disabled={updatingOrderId === order.id} onClick={() => void updateFulfillmentTime(order, { operation: "CONFIRM_REQUESTED", version: order.fulfillmentTimeVersion })} className="min-h-9 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50">{t("staff.order.acceptOriginalTime")}</button> : null}
                    <button type="button" disabled={updatingOrderId === order.id || fulfillmentTimeSlots.length === 0} onClick={() => openTimeProposal(order)} className="min-h-9 rounded-md border border-current px-3 text-xs font-semibold disabled:opacity-40">{order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? t("staff.order.editProposal") : t("staff.order.proposeTime")}</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {order.status === "WAITING_CONFIRMATION" ? (
              <p className="mt-3 text-xs font-medium text-amber-800">{t("staff.order.confirmBeforeProduction", { time: formatAppDateTime(locale, order.confirmationExpiresAt, { timeStyle: "short", timeZone: stall.timezone }) })}</p>
            ) : null}
            {order.status !== "WAITING_CONFIRMATION" ? (
              <div className="mt-4 flex flex-wrap gap-2 print:hidden">
                {order.items.some((item) => item.status === "PENDING")
                  && !fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)
                  && canTransitionOrderItem("PENDING", "PREPARING", account.role) ? (
                    <button
                      type="button"
                      disabled={updatingItemsOrderId === order.id || updatingItemId !== null}
                      onClick={() => void updateAllItemStatuses(order.id, "PREPARING")}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="h-4 w-4" />
                      {t("staff.order.allStart", { count: order.items.filter((item) => item.status === "PENDING").length })}
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
                      {t("staff.order.allReady", { count: order.items.filter((item) => item.status === "PREPARING").length })}
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
                      {order.fulfillmentType === "DINE_IN"
                        ? t("staff.order.allServed", { count: order.items.filter((item) => item.status === "READY").length })
                        : order.fulfillmentType === "DELIVERY"
                          ? t("staff.order.allDelivered", { count: order.items.filter((item) => item.status === "READY").length })
                          : t("staff.order.allPickedUp", { count: order.items.filter((item) => item.status === "READY").length })}
                    </button>
                  ) : null}
              </div>
            ) : null}
            <ul className="mt-4 divide-y divide-stone-100 border-y border-stone-200 text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="relative grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  {order.source !== "OFFLINE_POS" && canSelectItem(item.status, order.status, account.role) && !(item.status === "PENDING" && fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)) ? <input type="checkbox" aria-label={t("staff.order.selectItem", { order: order.orderNo, item: item.name })} checked={selectedItemIds.has(item.id)} onChange={(event) => setSelectedItemIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} className="absolute left-0 top-4 h-4 w-4 print:hidden" /> : null}
                  <div className={`min-w-0 ${order.source !== "OFFLINE_POS" && canSelectItem(item.status, order.status, account.role) && !(item.status === "PENDING" && fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)) ? "pl-7" : ""}`}>
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{item.quantity} × {item.name}</span>
                      <span>{formatMoney(item.unitPrice * item.quantity, stall.currency, locale)}</span>
                    </div>
                    {item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{formatStaffNoteOptions(locale, item.noteOptions, stall.currency, true)}</p> : null}
                    {item.note ? <p className="mt-1 text-xs text-stone-600">{t("staff.order.note", { note: item.note })}</p> : null}
                    <span className={`mt-1 inline-flex rounded px-2 py-0.5 text-xs font-semibold ${item.status === "SERVED" ? "bg-emerald-50 text-emerald-800" : item.status === "READY" ? "bg-blue-50 text-blue-800" : item.status === "PREPARING" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>
                    {orderItemStatusLabel(item.status, t)}
                    </span>
                  </div>
                  {order.source !== "OFFLINE_POS" && item.status !== "SERVED" && order.status !== "WAITING_CONFIRMATION" && !(item.status === "PENDING" && fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)) ? (
                    <ItemStatusButton
                      itemStatus={item.status}
                      role={account.role}
                      busy={updatingItemId === item.id || updatingItemsOrderId === order.id}
                      t={t}
                      onUpdate={(status) => void updateItemStatus(order.id, item.id, status)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            {order.note ? <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{order.note}</p> : null}
            <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-4">
              <div>
                {order.discountAmount > 0 ? <div className="text-xs text-stone-500">{t("staff.order.originalPrice", { amount: formatMoney(order.subtotal, stall.currency, locale) })} · {order.discountLabel}</div> : null}
                <strong>{formatMoney(order.total, stall.currency, locale)}</strong>
              </div>
                <span className="text-sm text-stone-600">{paymentStatusLabel(order.paymentStatus, t)}</span>
            </div>

            {modules.print && !order.isTest ? (
              <button
                type="button"
                onClick={() => void printOrder(order.id)}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-medium hover:bg-stone-100 print:hidden"
              >
                <Printer className="h-4 w-4" />{t("staff.order.queuePrint")}
              </button>
            ) : null}

            {order.status === "READY" && order.fulfillmentType === "TAKEOUT" && order.source === "QR_MENU" && hasPermission(account.role, "CHECKOUT_ORDERS") ? (
              order.pickupVerifiedAt ? (
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-teal-800">
                  <CheckCircle2 className="h-4 w-4" />
                  {order.pickupVerificationMethod === "MANUAL" ? t("staff.pickup.manualVerified") : t("staff.pickup.codeVerified")}
                </div>
              ) : (
                <div className="mt-4">
                  <div className="relative">
                    <input type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      aria-label={t("staff.pickup.codeLabel", { digits: order.pickupCodeLength })}
                      aria-busy={verifyingPickupOrderId === order.id}
                      disabled={verifyingPickupOrderId === order.id}
                      maxLength={order.pickupCodeLength === 6 ? 6 : 3}
                      pattern={order.pickupCodeLength === 6 ? "[0-9]{6}" : "[0-9]{3}"}
                      value={pickupCodes[order.id] ?? ""}
                      onChange={(event) => handlePickupCodeChange(order.id, event.target.value)}
                      className="h-11 w-full rounded-md border border-stone-300 px-3 pr-11 font-mono text-lg disabled:bg-stone-50"
                      placeholder={t("staff.pickup.codePlaceholder", { digits: order.pickupCodeLength })}
                    />
                    {verifyingPickupOrderId === order.id ? (
                      <span className="absolute inset-y-0 right-3 grid place-items-center text-teal-700" role="status">
                        <LoaderCircle className="h-5 w-5 animate-spin" />
                        <span className="sr-only">{t("staff.pickup.verifying")}</span>
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
                    <KeyRound className="h-4 w-4" />{t("staff.pickup.unavailable")}
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
                    {option.value === "COMPLETED" && order.paymentStatus === "UNPAID" ? t("staff.order.checkoutForCustomer") : staffStatusActionLabel(option.value, t)}
                  </button>
                ))}
            </div>
            </div> : null}
          </article>
        ))}
      </div>
      )}
      {viewMode === "TICKETS" && operationalOrders.length === 0 ? <p className="mt-10 text-center text-sm text-stone-500 print:hidden">{query ? t("staff.order.emptySearch") : t("staff.order.emptyToday")}</p> : null}

      {viewMode === "TICKETS" && futureOrders.length > 0 ? (
        <section className="mt-6 rounded-lg border border-sky-200 bg-sky-50 print:hidden">
          <button type="button" aria-expanded={futureOrdersExpanded} aria-controls="future-scheduled-orders" onClick={() => setFutureOrdersExpanded((current) => !current)} className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left">
            <div>
              <h2 className="font-semibold text-sky-950">{t("staff.future.countTitle", { count: futureOrders.length })}</h2>
              <p className="mt-1 text-xs text-sky-800">{t("staff.future.description", { amount: formatMoney(futureUnpaidTotal, stall.currency, locale) })}</p>
              <p className="mt-1 text-xs text-sky-700">{t("staff.future.dates", { dates: futureBusinessDateSummary(futureOrders, orderProductionTimings, t) })}</p>
            </div>
            {futureOrdersExpanded ? <ChevronUp className="h-5 w-5 shrink-0" /> : <ChevronDown className="h-5 w-5 shrink-0" />}
          </button>
          {futureOrdersExpanded ? (
            <div id="future-scheduled-orders" className="grid gap-3 border-t border-sky-200 p-4 md:grid-cols-2">
              {futureOrders.map((order) => {
                const timing = orderProductionTimings.get(order.id);
                return (
                  <article key={order.id} className="rounded-md border border-sky-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-stone-500">{t("staff.order.number", { number: order.orderNo })}</p>
                        <h3 className="mt-1 font-semibold">{order.customerName}</h3>
                      <p className="mt-1 text-sm font-medium text-sky-900">{futureOrderTimeLabel(order, timing, stall.timezone, locale, t)}</p>
                      </div>
                      <span className="rounded bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-900">{t("staff.future.notDue")}</span>
                    </div>
                    {order.fulfillmentType === "DELIVERY" ? <p className="mt-3 rounded bg-stone-50 px-3 py-2 text-sm">{t("staff.future.delivery", { details: `${order.deliveryAddress || t("staff.delivery.noAddress")}${order.customerPhone ? ` · ${order.customerPhone}` : ""}` })}</p> : null}
                    <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-200 text-sm">
                      {order.items.map((item) => <li key={item.id} className="py-2"><div className="flex justify-between gap-3"><span>{item.quantity} × {item.name}</span><span>{formatMoney(item.unitPrice * item.quantity, stall.currency, locale)}</span></div>{item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{formatStaffNoteOptions(locale, item.noteOptions, stall.currency, false)}</p> : null}{item.note ? <p className="mt-1 text-xs text-stone-600">{t("staff.order.note", { note: item.note })}</p> : null}</li>)}
                    </ul>
                    {order.note ? <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">{t("staff.order.orderNote", { note: order.note })}</p> : null}
                    <div className="mt-3 flex items-center justify-between"><strong>{formatMoney(order.total, stall.currency, locale)}</strong><span className="text-sm text-stone-600">{paymentStatusLabel(order.paymentStatus, t)}</span></div>
                    <p className="mt-3 text-xs font-medium text-sky-800">{t("staff.future.noProductionAction")}</p>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

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

      {editingOrder && orderCatalog ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4 print:hidden">
          <section role="dialog" aria-modal="true" aria-labelledby="order-edit-title" className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="order-edit-title" className="text-lg font-semibold">{t("staff.edit.title")}</h2>
                <p className="mt-1 text-sm text-stone-600">{t("staff.edit.description", { number: editingOrder.orderNo })}</p>
              </div>
              <button type="button" title={t("staff.edit.close")} disabled={orderEditBusy} onClick={() => setEditingOrderId(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-stone-300 disabled:opacity-50"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-5 divide-y divide-stone-100 border-y border-stone-200">
              {orderEditLines.map((line) => (
                <div key={line.key} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><strong>{line.name}</strong>{line.kind === "NEW" ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">{t("staff.edit.new")}</span> : null}</div>
                    {line.kind === "EXISTING" && line.details ? <p className="mt-1 text-xs text-stone-600">{line.details}</p> : null}
                    <p className="mt-1 text-xs text-stone-500">{formatMoney(line.unitPrice, stall.currency, locale)} × {line.quantity} = {formatMoney(line.unitPrice * line.quantity, stall.currency, locale)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label={t("staff.edit.decrease", { item: line.name })} disabled={orderEditBusy || line.quantity <= 1} onClick={() => changeOrderEditQuantity(line.key, -1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                    <span className="w-8 text-center font-semibold">{line.quantity}</span>
                    <button type="button" aria-label={t("staff.edit.increase", { item: line.name })} disabled={orderEditBusy || line.quantity >= 100} onClick={() => changeOrderEditQuantity(line.key, 1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                    <button type="button" disabled={orderEditBusy} onClick={() => setOrderEditLines((current) => current.filter((candidate) => candidate.key !== line.key))} className="ml-1 min-h-9 rounded-md border border-red-300 px-3 text-xs font-semibold text-red-700 disabled:opacity-40">{t("composer.remove")}</button>
                  </div>
                </div>
              ))}
              {orderEditLines.length === 0 ? <p className="py-6 text-center text-sm text-red-700">{t("staff.edit.minOne")}</p> : null}
            </div>

            <div className="mt-5 rounded-md border border-stone-200 bg-stone-50 p-4">
              <label htmlFor="order-edit-product" className="text-xs font-semibold text-stone-700">{t("staff.edit.addProduct")}</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <select id="order-edit-product" value={orderEditProductId} onChange={(event) => setOrderEditProductId(event.target.value)} disabled={orderEditBusy} className="h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3 text-sm disabled:opacity-50">
                  <option value="">{t("staff.edit.selectSimple")}</option>
                  {orderEditProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.price, stall.currency, locale)}</option>)}
                </select>
                <button type="button" disabled={orderEditBusy || !orderEditProductId} onClick={addOrderEditProduct} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />{t("staff.edit.add")}</button>
              </div>
              <p className="mt-2 text-xs leading-5 text-stone-600">{t("staff.edit.customizationWarning")}</p>
            </div>

            {orderEditMessage ? <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900">{orderEditMessage}</p> : null}
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-stone-200 pt-4">
              <div><p className="text-xs text-stone-500">{t("staff.edit.estimatedSubtotal")}</p><strong>{formatMoney(orderEditLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0), stall.currency, locale)}</strong></div>
              <div className="flex gap-2">
                <button type="button" disabled={orderEditBusy} onClick={() => setEditingOrderId(null)} className="min-h-10 rounded-md border border-stone-300 px-4 text-sm font-medium disabled:opacity-50">{t("common.back")}</button>
                <button type="button" disabled={orderEditBusy || orderEditLines.length === 0} onClick={() => void saveOrderEdit()} className="min-h-10 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40">{orderEditBusy ? t("staff.edit.repricing") : t("staff.edit.save")}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {checkoutOrder ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4 print:hidden">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-lg bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="checkout-title" className="text-lg font-semibold">{checkoutOrders.length > 1 ? t("staff.checkout.combined") : t("staff.checkout.completeOrder")}</h2>
                <p className="mt-1 text-sm text-stone-600">
                  {checkoutOrders.length > 1 ? t("staff.checkout.summary", { table: checkoutOrder.tableLabel ?? t("staff.table.unassigned"), count: checkoutOrders.length }) : `${t("staff.order.number", { number: checkoutOrder.orderNo })} · ${checkoutOrder.fulfillmentType === "DINE_IN" ? checkoutOrder.tableLabel : checkoutOrder.customerName}`}
                </p>
                {checkoutOrders.length > 1 ? <p className="mt-1 text-xs text-stone-500">{checkoutOrders.map((order) => order.orderNo).join("、")}</p> : null}
              </div>
              <button
                type="button"
                title={t("staff.checkout.close")}
                disabled={updatingOrderId === checkoutOrder.id}
                onClick={() => setCheckoutOrders([])}
                className="grid h-9 w-9 place-items-center rounded-md border border-stone-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5">
              <h3 className="text-xs font-semibold text-stone-600">{t("staff.checkout.paymentMethod")}</h3>
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
                ) : <p className="mt-2 text-sm text-red-700">{t("staff.checkout.noMethods")}</p>
              ) : (
                <div className="mt-2 rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-semibold">{t("composer.cash")}</div>
              )}
            </div>

            <StaffDiscountSelector
              enabled={modules.discount}
              options={discountOptions}
              selectedOptionId={selectedDiscountOptionId}
              onSelect={setSelectedDiscountOptionId}
              settingsHref={hasPermission(account.role, "MANAGE_STALL") ? `/merchant/stalls/${stall.id}/settings/modules?source=staff#discount-options` : undefined}
              isApplicable={checkoutDiscountEligibleSubtotal > 0}
              existingDiscountLabel={checkoutPreview.discountAmount > 0
                ? checkoutPreview.discountLabel ?? t("staff.checkout.existingDiscount")
                : null}
            />

            {checkoutDiscountEligibleSubtotal < checkoutSubtotal ? <p className="mt-2 text-xs text-amber-800">{t("composer.discountEligible", { amount: formatMoney(checkoutDiscountEligibleSubtotal, stall.currency, locale) })}</p> : null}

            {checkoutNeedsApproval ? (
              <div className="mt-5 rounded-md border border-amber-300 bg-amber-50 p-4">
                <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" /><div><h3 className="text-sm font-semibold text-amber-950">{t("staff.checkout.approvalTitle")}</h3><p className="mt-1 text-xs text-amber-900">{t("staff.checkout.approvalHelp")}</p></div></div>
                <label className="mt-3 block text-xs font-semibold text-stone-700">{t("staff.checkout.discountReason")}<input type="text" value={discountApprovalReason} maxLength={200} onChange={(event) => setDiscountApprovalReason(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label>
                {!operatorCanApproveDiscount ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-stone-700">{t("composer.managerEmail")}<input type="email" autoComplete="username" value={managerEmail} maxLength={254} onChange={(event) => setManagerEmail(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label><label className="text-xs font-semibold text-stone-700">{t("composer.managerPassword")}<input type="password" autoComplete="current-password" value={managerPassword} maxLength={128} onChange={(event) => setManagerPassword(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label></div> : <p className="mt-3 text-xs font-semibold text-emerald-800">{t("staff.checkout.directApproval")}</p>}
              </div>
            ) : null}

            <dl className="mt-5 space-y-2 border-y border-stone-200 py-4 text-sm">
              <div className="flex justify-between"><dt>{t("composer.subtotal")}</dt><dd>{formatMoney(checkoutSubtotal, stall.currency, locale)}</dd></div>
              {checkoutPreview.discountAmount > 0 ? <div className="flex justify-between text-emerald-800"><dt>{checkoutPreview.discountLabel ?? t("staff.checkout.existingDiscount")}</dt><dd>-{formatMoney(checkoutPreview.discountAmount, stall.currency, locale)}</dd></div> : null}
              <div className="flex justify-between text-lg font-semibold"><dt>{t("composer.amountDue")}</dt><dd>{formatMoney(checkoutTotal, stall.currency, locale)}</dd></div>
            </dl>

            {checkoutUsesCash ? (
              <div className="mt-5">
                <label className="text-xs font-semibold text-stone-600" htmlFor="cash-received">{t("staff.checkout.cashReceived")}</label>
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
                      {index === 0 ? t("composer.exact") : formatMoney(value, stall.currency, locale)}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-between rounded-md bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900">
                  <span>{t("composer.change")}</span><span>{formatMoney(checkoutChange, stall.currency, locale)}</span>
                </div>
              </div>
            ) : null}

            {message ? (
              <div role="alert" className="mt-5 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="font-semibold">{message}</p>
                </div>
                {cashShiftRequired ? (
                  <Link
                    href={`/staff/${stall.slug}/cash`}
                    className="mt-3 inline-flex min-h-10 items-center rounded-md bg-teal-800 px-4 py-2 font-semibold text-white"
                  >
                    {t("staff.checkout.cashShift")}
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
                {t("common.back")}
              </button>
              <button
                type="button"
                disabled={!checkoutReady || updatingOrderId === checkoutOrder.id}
                onClick={() => void completeCheckout()}
                className="rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updatingOrderId === checkoutOrder.id ? t("staff.checkout.processing") : t("staff.checkout.completeOrder")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingTimeProposal && timeProposalOrder ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="time-proposal-title" className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="time-proposal-title" className="text-lg font-semibold">{t("staff.time.title", { kind: timeProposalOrder.fulfillmentType === "DELIVERY" ? t("staff.fulfillment.delivery") : t("staff.fulfillment.pickup") })}</h2>
                <p className="mt-1 text-sm text-stone-600">{t("staff.time.description", { number: pendingTimeProposal.orderNo })}</p>
              </div>
              <button type="button" title={t("staff.time.close")} disabled={updatingOrderId === timeProposalOrder.id} onClick={() => setPendingTimeProposal(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 disabled:opacity-50"><X className="h-4 w-4" /></button>
            </div>
            <FulfillmentTimePicker
              slots={fulfillmentTimeSlots}
              value={pendingTimeProposal.proposedFulfillmentAt}
              onChange={(value) => setPendingTimeProposal((current) => (
                current ? { ...current, proposedFulfillmentAt: value } : null
              ))}
              legend={t("staff.time.suggestion")}
              scheduledLabel={timeProposalOrder.fulfillmentType === "DELIVERY" ? t("composer.scheduledDelivery") : t("composer.scheduledPickup")}
              dateLabel={timeProposalOrder.fulfillmentType === "DELIVERY" ? t("composer.deliveryDate") : t("composer.pickupDate")}
              timeLabel={timeProposalOrder.fulfillmentType === "DELIVERY" ? t("composer.deliveryTime") : t("composer.pickupTime")}
              unavailableDateMessage={t("staff.time.unavailable")}
              allowAsap={false}
              required
              disabled={updatingOrderId === timeProposalOrder.id}
              testId="staff-time-proposal-fields"
              className="mt-5"
            />
            <label className="mt-4 block text-xs font-semibold text-stone-700">{t("staff.time.reason")}<textarea value={pendingTimeProposal.reason} maxLength={200} onChange={(event) => setPendingTimeProposal((current) => current ? { ...current, reason: event.target.value } : null)} className="mt-1 min-h-20 w-full resize-y rounded-md border border-stone-300 p-3 text-sm" /></label>
            <p className="mt-3 text-xs leading-5 text-amber-800">{t("staff.time.holdOriginal")}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" disabled={updatingOrderId === timeProposalOrder.id} onClick={() => setPendingTimeProposal(null)} className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-50">{t("staff.time.back")}</button>
              <button type="button" disabled={updatingOrderId === timeProposalOrder.id || pendingTimeProposal.reason.trim().length < 2 || !pendingTimeProposal.proposedFulfillmentAt} onClick={() => void updateFulfillmentTime(timeProposalOrder, { operation: "PROPOSE", version: pendingTimeProposal.version, proposedFulfillmentAt: pendingTimeProposal.proposedFulfillmentAt, reason: pendingTimeProposal.reason.trim() })} className="min-h-11 rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{updatingOrderId === timeProposalOrder.id ? t("staff.time.notifying") : t("staff.time.notify")}</button>
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
                <h2 id="manual-pickup-title" className="text-lg font-semibold">{t("staff.manual.title")}</h2>
                <p className="mt-1 text-sm font-medium text-stone-800">
                  {t("staff.order.number", { number: manualPickupOrder.orderNo })} · {manualPickupOrder.customerName}
                </p>
              </div>
              <button
                type="button"
                title={t("staff.manual.close")}
                disabled={verifyingPickupOrderId === manualPickupOrder.id}
                onClick={() => setPendingManualPickup(null)}
                className="grid h-9 w-9 place-items-center rounded-md border border-stone-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p id="manual-pickup-description" className="mt-4 text-sm leading-6 text-stone-600">
              {t("staff.manual.help")}
            </p>
            <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-200 text-sm">
              {manualPickupOrder.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 py-2">
                  <span>{item.quantity} × {item.name}</span>
                <span className="text-stone-500">{orderItemStatusLabel(item.status, t)}</span>
                </li>
              ))}
            </ul>
            <label className="mt-4 block text-xs font-semibold text-stone-600">
              {t("staff.manual.reason")}
              <select
                value={pendingManualPickup.reason}
                onChange={(event) => setPendingManualPickup((current) => current ? {
                  ...current,
                  reason: event.target.value as ManualPickupReason,
                } : null)}
                className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
              >
                <option value="DEVICE_LOST">{t("staff.manual.deviceLost")}</option>
                <option value="TRACKING_UNAVAILABLE">{t("staff.manual.trackingUnavailable")}</option>
                <option value="OTHER">{t("staff.manual.other")}</option>
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
              {t("staff.manual.confirmed")}
            </label>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={verifyingPickupOrderId === manualPickupOrder.id}
                onClick={() => setPendingManualPickup(null)}
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                {t("common.back")}
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
                {verifyingPickupOrderId === manualPickupOrder.id ? t("staff.manual.checking") : t("staff.manual.confirm")}
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
                <h2 id="cancel-order-title" className="text-lg font-semibold">{t("staff.cancel.title")}</h2>
                <p className="mt-1 break-words text-sm font-medium text-stone-800">
                  {t("staff.order.number", { number: pendingCancellation.orderNo })} · {pendingCancellation.customerName}
                </p>
              </div>
            </div>
            <p id="cancel-order-description" className="mt-4 text-sm leading-6 text-stone-600">
              {t("staff.cancel.warning")}
            </p>
            <label className="mt-4 block text-xs font-semibold text-stone-700">{t("staff.cancel.reason")}<select value={pendingCancellation.reason} onChange={(event) => setPendingCancellation((current) => current ? { ...current, reason: event.target.value as CancellationReason } : null)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{cancellationReasons.map((reason) => <option key={reason} value={reason}>{cancellationReasonLabel(reason, t)}</option>)}</select></label>
            <label className="mt-4 block text-xs font-semibold text-stone-700">{t("staff.cancel.detail", { requirement: pendingCancellation.reason === "OTHER" ? t("staff.cancel.required") : t("staff.cancel.optional") })}<textarea value={pendingCancellation.detail} maxLength={200} onChange={(event) => setPendingCancellation((current) => current ? { ...current, detail: event.target.value } : null)} className="mt-1 min-h-20 w-full resize-y rounded-md border border-stone-300 p-3 text-sm" /></label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                autoFocus
                disabled={updatingOrderId === pendingCancellation.id || (pendingCancellation.reason === "OTHER" && !pendingCancellation.detail.trim())}
                onClick={() => setPendingCancellation(null)}
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50"
              >
                {t("staff.time.back")}
              </button>
              <button
                type="button"
                disabled={updatingOrderId === pendingCancellation.id}
                onClick={() => void confirmCancellation()}
                className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updatingOrderId === pendingCancellation.id ? t("staff.cancel.processing") : t("staff.cancel.confirm")}
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

function LiveConnectionBadge({ state, t }: { state: LiveConnectionState; t: OperationsTranslator }) {
  const connected = state === "sse" || state === "realtime";
  const label = state === "sse"
    ? t("staff.live.sse")
    : state === "realtime"
      ? t("staff.live.realtime")
      : state === "polling"
        ? t("staff.live.polling")
        : t("staff.live.connecting");
  const title = state === "sse"
    ? t("staff.live.sseTitle")
    : state === "realtime"
      ? t("staff.live.realtimeTitle")
      : state === "polling"
        ? t("staff.live.pollingTitle")
        : t("staff.live.connectingTitle");

  return (
    <span
      role="status"
      aria-label={label}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border text-xs font-medium ${connected ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}
      title={title}
    >
      {connected ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ItemStatusButton({
  itemStatus,
  role,
  busy,
  t,
  onUpdate,
}: {
  itemStatus: OrderItemStatus;
  role: UserRole;
  busy: boolean;
  t: OperationsTranslator;
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

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onUpdate(nextStatus)}
      className="min-h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
    >
      {busy ? t("staff.action.updating") : batchActionLabel(nextStatus, t)}
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

function fulfillmentTimeNeedsResponse(state: StaffOrderDto["fulfillmentTimeState"]) {
  return state === "REQUESTED" || state === "CUSTOMER_ACTION_REQUIRED";
}

function formatStaffFulfillmentTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function fulfillmentTimeTitle(order: StaffOrderDto, locale: string, t: OperationsTranslator) {
  const kind = order.fulfillmentType === "DELIVERY" ? t("staff.fulfillment.delivery") : t("staff.fulfillment.pickup");
  if (order.fulfillmentTimeState === "REQUESTED" && order.requestedFulfillmentAt) {
    return t("staff.fulfillment.customerRequested", { kind, time: formatStaffFulfillmentTime(order.requestedFulfillmentAt, locale) });
  }
  if (order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" && order.pendingFulfillmentAt) {
    return t("staff.fulfillment.waitingCustomer", { kind, time: formatStaffFulfillmentTime(order.pendingFulfillmentAt, locale) });
  }
  if (order.fulfillmentTimeState === "CONFIRMED" && order.committedFulfillmentAt) {
    return t("staff.fulfillment.confirmed", { kind, time: formatStaffFulfillmentTime(order.committedFulfillmentAt, locale) });
  }
  if (order.fulfillmentTimeState === "DECLINED") {
    return order.committedFulfillmentAt
      ? t("staff.fulfillment.kept", { time: formatStaffFulfillmentTime(order.committedFulfillmentAt, locale) })
      : t("staff.fulfillment.rejected");
  }
  if (order.fulfillmentTimeState === "EXPIRED") {
    return t("staff.fulfillment.expired");
  }
  return t("staff.fulfillment.unconfirmed", { kind });
}

function batchActionLabel(status: "PREPARING" | "READY" | "SERVED", t: OperationsTranslator) {
  return status === "PREPARING" ? t("staff.action.startPreparing") : status === "READY" ? t("staff.action.markReady") : t("staff.action.markServed");
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

function paymentStatusLabel(status: StaffOrderDto["paymentStatus"], t: OperationsTranslator) {
  return t(status === "UNPAID"
    ? "staff.payment.unpaid"
    : status === "PENDING_RECONCILIATION"
      ? "staff.payment.reconciliation"
      : status === "PAID"
        ? "staff.payment.paid"
        : "staff.payment.refunded");
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
            ? "staff.status.ready"
            : status === "COMPLETED"
              ? "staff.status.completed"
              : status === "CANCELLED"
                ? "staff.status.cancelled"
                : "staff.status.expired");
}

function contextualOrderStatusLabel(order: Pick<StaffOrderDto, "status" | "source" | "paymentStatus" | "fulfillmentType">, t: OperationsTranslator) {
  if (order.status !== "READY" || order.source === "QR_MENU") return orderStatusLabel(order.status, t);
  if (order.fulfillmentType === "DINE_IN") return t("staff.status.awaitingService");
  if (order.source === "STAFF_POS" && order.paymentStatus === "UNPAID") return t("staff.status.awaitingCheckout");
  if (order.fulfillmentType === "DELIVERY" && order.paymentStatus === "PAID") return t("staff.status.awaitingDelivery");
  if (order.fulfillmentType === "TAKEOUT" && order.paymentStatus === "PAID") return t("staff.status.awaitingPickup");
  return orderStatusLabel(order.status, t);
}

function staffStatusActionLabel(status: StaffStatus, t: OperationsTranslator) {
  return status === "CONFIRMED"
    ? t("staff.status.confirmed")
    : status === "PREPARING"
      ? t("staff.action.startPreparing")
      : status === "PACKING"
        ? t("staff.status.packing")
        : status === "READY"
          ? t("staff.action.markReady")
          : status === "COMPLETED"
            ? t("staff.checkout.completeOrder")
            : t("staff.cancel.confirm");
}

function cancellationReasonLabel(reason: CancellationReason, t: OperationsTranslator) {
  return t(reason === "SOLD_OUT"
    ? "staff.cancel.soldOut"
    : reason === "CUSTOMER_CANCELLED"
      ? "staff.cancel.customerRequest"
      : reason === "WAIT_TOO_LONG"
        ? "staff.cancel.waitTooLong"
        : reason === "DUPLICATE_ORDER"
          ? "staff.cancel.duplicate"
          : "staff.cancel.other");
}

function orderAgeMinutes(order: StaffOrderDto, timing: FulfillmentProductionTiming | undefined, now: number) {
  const anchor = timing?.effectiveFulfillmentAt?.getTime() ?? new Date(order.createdAt).getTime();
  return Math.max(0, Math.floor((now - anchor) / 60_000));
}

function orderAgeClasses(order: StaffOrderDto, timing: FulfillmentProductionTiming | undefined, now: number) {
  const minutes = orderAgeMinutes(order, timing, now);
  if (minutes >= 20) return "border-red-300 bg-red-50";
  if (minutes >= 10) return "border-amber-300 bg-amber-50";
  return "border-stone-200 bg-white";
}

function orderTimingSummary(
  order: StaffOrderDto,
  timing: FulfillmentProductionTiming | undefined,
  now: number,
  timeZone: string,
  locale: string,
  t: OperationsTranslator,
) {
  const fulfillment = order.fulfillmentType === "DINE_IN"
    ? t("staff.timing.dineIn", { table: order.tableLabel ?? t("staff.table.unassigned") })
    : order.fulfillmentType === "DELIVERY" ? t("staff.timing.deliveryOrder") : t("staff.timing.takeout");
  if (timing?.effectiveFulfillmentAt) {
    const label = order.fulfillmentType === "DELIVERY" ? t("staff.timing.scheduledDelivery") : t("staff.timing.scheduledPickup");
    const deltaMs = timing.effectiveFulfillmentAt.getTime() - now;
    const relative = deltaMs > 0
      ? t("staff.timing.until", { minutes: Math.ceil(deltaMs / 60_000) })
      : t("staff.timing.overdue", { minutes: Math.max(0, Math.floor(-deltaMs / 60_000)) });
    return `${fulfillment} · ${label} ${formatZonedDateTime(timing.effectiveFulfillmentAt, timeZone, locale)} · ${relative}`;
  }
  return t("staff.timing.orderedWait", { fulfillment, time: formatZonedDateTime(new Date(order.createdAt), timeZone, locale, false), minutes: orderAgeMinutes(order, timing, now) });
}

function futureOrderTimeLabel(
  order: StaffOrderDto,
  timing: FulfillmentProductionTiming | undefined,
  timeZone: string,
  locale: string,
  t: OperationsTranslator,
) {
  const label = order.fulfillmentType === "DELIVERY" ? t("staff.timing.scheduledDelivery") : t("staff.timing.scheduledPickup");
  return timing?.effectiveFulfillmentAt
    ? `${label}: ${formatZonedDateTime(timing.effectiveFulfillmentAt, timeZone, locale)}`
    : t("staff.future.pendingTime", { label });
}

function futureBusinessDateSummary(
  orders: StaffOrderDto[],
  timings: Map<string, FulfillmentProductionTiming>,
  t: OperationsTranslator,
) {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const date = timings.get(order.id)?.fulfillmentBusinessDate ?? t("staff.future.unknownDate");
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, count]) => t("staff.future.dateCount", { date, count })).join(", ");
}

function formatZonedDateTime(value: Date, timeZone: string, locale: string, includeDate = true) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(includeDate ? { month: "numeric", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
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
