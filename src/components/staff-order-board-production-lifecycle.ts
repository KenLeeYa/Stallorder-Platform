"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { OrderItemStatus } from "@prisma/client";
import {
  undoStaffOrderItemBatch,
  updateStaffOrderItemBatch,
  type StaffOrderUndoBatch,
} from "@/components/staff-order-board-batch";
import {
  applyStaffOrderProductionResult,
  transitionAllStaffOrderItemStatuses,
  transitionStaffOrderItemStatus,
  transitionStaffOrderStatus,
  type StaffOrderProductionStatus,
  type StaffOrderStatusTransitionOptions,
} from "@/components/staff-order-board-production";
import type { StaffOrderDto } from "@/lib/orders";

const NETWORK_ERROR_MESSAGE = "網路連線中斷，請稍後再試。";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type StaffOrderProductionLifecycleDependencies = {
  transitionOrder: typeof transitionStaffOrderStatus;
  transitionItem: typeof transitionStaffOrderItemStatus;
  transitionAllItems: typeof transitionAllStaffOrderItemStatuses;
  updateItemBatch: typeof updateStaffOrderItemBatch;
  undoItemBatch: typeof undoStaffOrderItemBatch;
};

type StaffOrderProductionLifecycleBindings = {
  stallSlug: string;
  getOrders: () => StaffOrderDto[];
  getUndoBatch: () => StaffOrderUndoBatch | null;
  setOrders: StateSetter<StaffOrderDto[]>;
  setMessage: (message: string) => void;
  setUpdatingOrderId: StateSetter<string | null>;
  setUpdatingItemId: StateSetter<string | null>;
  setUpdatingItemsOrderId: StateSetter<string | null>;
  setSelectedItemIds: StateSetter<Set<string>>;
  setBatchBusy: StateSetter<boolean>;
  setUndoBatch: StateSetter<StaffOrderUndoBatch | null>;
};

const productionDependencies: StaffOrderProductionLifecycleDependencies = {
  transitionOrder: transitionStaffOrderStatus,
  transitionItem: transitionStaffOrderItemStatus,
  transitionAllItems: transitionAllStaffOrderItemStatuses,
  updateItemBatch: updateStaffOrderItemBatch,
  undoItemBatch: undoStaffOrderItemBatch,
};

export function reconcileStaffOrderProductionSelection(
  current: ReadonlySet<string>,
  authoritativeOrders: readonly Pick<StaffOrderDto, "items">[],
) {
  const availableItemIds = new Set(
    authoritativeOrders.flatMap((order) => order.items.map((item) => item.id)),
  );
  return new Set([...current].filter((id) => availableItemIds.has(id)));
}

export function replaceStaffOrderProductionOrders(
  current: StaffOrderDto[],
  authoritativeOrders: StaffOrderDto[],
) {
  const replacements = new Map(authoritativeOrders.map((order) => [order.id, order]));
  return current.map((order) => replacements.get(order.id) ?? order);
}

export function createStaffOrderProductionLifecycle(
  bindings: StaffOrderProductionLifecycleBindings,
  dependencies: StaffOrderProductionLifecycleDependencies = productionDependencies,
) {
  const {
    stallSlug,
    getOrders,
    getUndoBatch,
    setOrders,
    setMessage,
    setUpdatingOrderId,
    setUpdatingItemId,
    setUpdatingItemsOrderId,
    setSelectedItemIds,
    setBatchBusy,
    setUndoBatch,
  } = bindings;

  async function updateOrder(
    orderId: string,
    status: StaffOrderProductionStatus,
    options: StaffOrderStatusTransitionOptions = {},
  ) {
    setMessage("");
    setUpdatingOrderId(orderId);
    try {
      const result = await dependencies.transitionOrder({
        stallSlug,
        currentOrder: getOrders().find((order) => order.id === orderId),
        orderId,
        status,
        options,
      });
      setOrders((current) => applyStaffOrderProductionResult(current, result));
      if (result.message) setMessage(result.message);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : NETWORK_ERROR_MESSAGE);
      return false;
    } finally {
      setUpdatingOrderId(null);
    }
  }

  async function updateItemStatus(
    orderId: string,
    itemId: string,
    status: Exclude<OrderItemStatus, "PENDING">,
  ) {
    setMessage("");
    setUpdatingItemId(itemId);
    try {
      const result = await dependencies.transitionItem({
        stallSlug,
        orderId,
        itemId,
        status,
      });
      setOrders((current) => applyStaffOrderProductionResult(current, result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : NETWORK_ERROR_MESSAGE);
    } finally {
      setUpdatingItemId(null);
    }
  }

  async function updateAllItemStatuses(
    orderId: string,
    status: "PREPARING" | "READY" | "SERVED",
  ) {
    setMessage("");
    setUpdatingItemsOrderId(orderId);
    try {
      const result = await dependencies.transitionAllItems({
        stallSlug,
        currentOrder: getOrders().find((order) => order.id === orderId),
        orderId,
        status,
      });
      setOrders((current) => applyStaffOrderProductionResult(current, result));
      if (result.message) setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : NETWORK_ERROR_MESSAGE);
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
      const result = await dependencies.updateItemBatch({ stallSlug, itemIds, status });
      setOrders((current) => replaceStaffOrderProductionOrders(current, result.orders));
      setSelectedItemIds(new Set());
      setUndoBatch(result.undoBatch);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : NETWORK_ERROR_MESSAGE);
    } finally {
      setBatchBusy(false);
    }
  }

  async function undoSelectedItems() {
    const undoBatch = getUndoBatch();
    if (!undoBatch) return;
    setBatchBusy(true);
    setMessage("");
    try {
      const authoritativeOrders = await dependencies.undoItemBatch({
        stallSlug,
        actionId: undoBatch.actionId,
      });
      setOrders((current) => replaceStaffOrderProductionOrders(current, authoritativeOrders));
      setUndoBatch(null);
      setMessage("已復原上一筆批次餐點操作。");
    } catch (error) {
      setUndoBatch(null);
      setMessage(error instanceof Error ? error.message : NETWORK_ERROR_MESSAGE);
    } finally {
      setBatchBusy(false);
    }
  }

  function reconcile(authoritativeOrders: StaffOrderDto[]) {
    setSelectedItemIds((current) => (
      reconcileStaffOrderProductionSelection(current, authoritativeOrders)
    ));
  }

  function toggleSelectedItem(itemId: string, selected: boolean) {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (selected) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  function clearSelectedItems() {
    setSelectedItemIds(new Set());
  }

  return {
    clearSelectedItems,
    reconcile,
    toggleSelectedItem,
    undoSelectedItems,
    updateAllItemStatuses,
    updateItemStatus,
    updateOrder,
    updateSelectedItems,
  };
}

export function useStaffOrderProductionLifecycle({
  stallSlug,
  orders,
  setOrders,
  setMessage,
}: {
  stallSlug: string;
  orders: StaffOrderDto[];
  setOrders: StateSetter<StaffOrderDto[]>;
  setMessage: (message: string) => void;
}) {
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [updatingItemsOrderId, setUpdatingItemsOrderId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [undoBatch, setUndoBatch] = useState<StaffOrderUndoBatch | null>(null);
  const lifecycle = createStaffOrderProductionLifecycle({
    stallSlug,
    getOrders: () => orders,
    getUndoBatch: () => undoBatch,
    setOrders,
    setMessage,
    setUpdatingOrderId,
    setUpdatingItemId,
    setUpdatingItemsOrderId,
    setSelectedItemIds,
    setBatchBusy,
    setUndoBatch,
  });
  const reconcile = useCallback((authoritativeOrders: StaffOrderDto[]) => {
    setSelectedItemIds((current) => (
      reconcileStaffOrderProductionSelection(current, authoritativeOrders)
    ));
  }, []);

  useEffect(() => {
    if (!undoBatch) return;
    const delay = Math.max(0, new Date(undoBatch.undoExpiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => setUndoBatch(null), delay);
    return () => window.clearTimeout(timer);
  }, [undoBatch]);

  return {
    ...lifecycle,
    batchBusy,
    reconcile,
    selectedItemIds,
    setUpdatingOrderId,
    undoBatch,
    updatingItemId,
    updatingItemsOrderId,
    updatingOrderId,
  };
}
