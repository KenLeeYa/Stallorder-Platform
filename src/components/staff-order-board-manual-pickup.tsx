"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { StaffOrderManualPickupReason } from "@/components/staff-order-board-fulfillment";
import { orderItemStatusLabels, type StaffOrderDto } from "@/lib/orders";

type PendingManualPickup = {
  orderId: string;
  reason: StaffOrderManualPickupReason;
  confirmedCustomerDetails: boolean;
};

type UseStaffOrderManualPickupOptions = {
  verifyingPickupOrderId: string | null;
  onConfirm: (
    orderId: string,
    reason: StaffOrderManualPickupReason,
  ) => Promise<boolean>;
};

export type StaffOrderManualPickupController = {
  pending: PendingManualPickup | null;
  open: (orderId: string) => void;
  reconcile: (orders: readonly Pick<StaffOrderDto, "id">[]) => void;
  setReason: (reason: StaffOrderManualPickupReason) => void;
  setConfirmedCustomerDetails: (confirmed: boolean) => void;
  dismiss: () => void;
  confirm: () => Promise<void>;
};

export function useStaffOrderManualPickup({
  verifyingPickupOrderId,
  onConfirm,
}: UseStaffOrderManualPickupOptions): StaffOrderManualPickupController {
  const [pending, setPending] = useState<PendingManualPickup | null>(null);

  const dismiss = useCallback(() => setPending(null), []);
  const open = useCallback((orderId: string) => {
    setPending({
      orderId,
      reason: "DEVICE_LOST",
      confirmedCustomerDetails: false,
    });
  }, []);
  const reconcile = useCallback((orders: readonly Pick<StaffOrderDto, "id">[]) => {
    setPending((current) => (
      current && !orders.some((order) => order.id === current.orderId) ? null : current
    ));
  }, []);
  const setReason = useCallback((reason: StaffOrderManualPickupReason) => {
    setPending((current) => current ? { ...current, reason } : null);
  }, []);
  const setConfirmedCustomerDetails = useCallback((confirmedCustomerDetails: boolean) => {
    setPending((current) => current ? { ...current, confirmedCustomerDetails } : null);
  }, []);

  const confirm = useCallback(async () => {
    if (
      !pending
      || verifyingPickupOrderId === pending.orderId
      || !pending.confirmedCustomerDetails
    ) return;
    const verified = await onConfirm(pending.orderId, pending.reason);
    if (verified) dismiss();
  }, [dismiss, onConfirm, pending, verifyingPickupOrderId]);

  useEffect(() => {
    if (!pending) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && verifyingPickupOrderId !== pending.orderId) dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismiss, pending, verifyingPickupOrderId]);

  return {
    pending,
    open,
    reconcile,
    setReason,
    setConfirmedCustomerDetails,
    dismiss,
    confirm,
  };
}

export function StaffOrderManualPickupDialog({
  controller,
  orders,
  verifyingPickupOrderId,
}: {
  controller: StaffOrderManualPickupController;
  orders: readonly StaffOrderDto[];
  verifyingPickupOrderId: string | null;
}) {
  const pending = controller.pending;
  const order = pending
    ? orders.find((candidate) => candidate.id === pending.orderId) ?? null
    : null;
  if (!pending || !order) return null;

  const busy = verifyingPickupOrderId === order.id;

  return (
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
              訂單 {order.orderNo} · {order.customerName}
            </p>
          </div>
          <button
            type="button"
            title="關閉人工核對視窗"
            disabled={busy}
            onClick={controller.dismiss}
            className="grid h-9 w-9 place-items-center rounded-md border border-stone-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p id="manual-pickup-description" className="mt-4 text-sm leading-6 text-stone-600">
          僅限顧客無法開啟訂單追蹤頁時使用。請先向顧客核對稱呼與餐點內容，系統會保留人工放行紀錄。
        </p>
        <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-200 text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 py-2">
              <span>{item.quantity} × {item.name}</span>
              <span className="text-stone-500">{orderItemStatusLabels[item.status]}</span>
            </li>
          ))}
        </ul>
        <label className="mt-4 block text-xs font-semibold text-stone-600">
          無法取得原因
          <select
            value={pending.reason}
            onChange={(event) => controller.setReason(event.target.value as StaffOrderManualPickupReason)}
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
            checked={pending.confirmedCustomerDetails}
            onChange={(event) => controller.setConfirmedCustomerDetails(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          已向顧客核對稱呼與全部餐點內容
        </label>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={controller.dismiss}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            返回
          </button>
          <button
            type="button"
            disabled={busy || !pending.confirmedCustomerDetails}
            onClick={() => void controller.confirm()}
            className="rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "核對中…" : "確認人工取餐"}
          </button>
        </div>
      </section>
    </div>
  );
}
