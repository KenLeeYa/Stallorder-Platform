"use client";

import { useCallback, useEffect, useState } from "react";
import type { CancellationReason } from "@prisma/client";
import { TriangleAlert } from "lucide-react";
import { cancellationReasonOptions } from "@/lib/cancellation-reasons";
import type { StaffOrderDto } from "@/lib/orders";

type CancellationOrder = Pick<StaffOrderDto, "id" | "orderNo" | "customerName">;

type PendingCancellation = CancellationOrder & {
  reason: CancellationReason;
  detail: string;
};

type CancellationTransitionOptions = {
  confirmationOrderNo: string;
  cancellationReason: CancellationReason;
  cancellationDetail: string | null;
};

type UseStaffOrderCancellationOptions = {
  updatingOrderId: string | null;
  onConfirm: (
    orderId: string,
    options: CancellationTransitionOptions,
  ) => Promise<boolean>;
};

export type StaffOrderCancellationController = {
  pending: PendingCancellation | null;
  open: (order: CancellationOrder) => void;
  reconcile: (orders: readonly Pick<StaffOrderDto, "id">[]) => void;
  setReason: (reason: CancellationReason) => void;
  setDetail: (detail: string) => void;
  dismiss: () => void;
  confirm: () => Promise<void>;
};

export function useStaffOrderCancellation({
  updatingOrderId,
  onConfirm,
}: UseStaffOrderCancellationOptions): StaffOrderCancellationController {
  const [pending, setPending] = useState<PendingCancellation | null>(null);

  const dismiss = useCallback(() => setPending(null), []);
  const open = useCallback((order: CancellationOrder) => {
    setPending({
      ...order,
      reason: "CUSTOMER_CANCELLED",
      detail: "",
    });
  }, []);
  const reconcile = useCallback((orders: readonly Pick<StaffOrderDto, "id">[]) => {
    setPending((current) => (
      current && !orders.some((order) => order.id === current.id) ? null : current
    ));
  }, []);
  const setReason = useCallback((reason: CancellationReason) => {
    setPending((current) => current ? { ...current, reason } : null);
  }, []);
  const setDetail = useCallback((detail: string) => {
    setPending((current) => current ? { ...current, detail } : null);
  }, []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    const cancelled = await onConfirm(pending.id, {
      confirmationOrderNo: pending.orderNo,
      cancellationReason: pending.reason,
      cancellationDetail: pending.detail.trim() || null,
    });
    if (cancelled) dismiss();
  }, [dismiss, onConfirm, pending]);

  useEffect(() => {
    if (!pending) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && updatingOrderId !== pending.id) dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismiss, pending, updatingOrderId]);

  return { pending, open, reconcile, setReason, setDetail, dismiss, confirm };
}

export function StaffOrderCancellationDialog({
  controller,
  updatingOrderId,
}: {
  controller: StaffOrderCancellationController;
  updatingOrderId: string | null;
}) {
  const pending = controller.pending;
  if (!pending) return null;

  return (
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
              訂單 {pending.orderNo} · {pending.customerName}
            </p>
          </div>
        </div>
        <p id="cancel-order-description" className="mt-4 text-sm leading-6 text-stone-600">
          取消後無法恢復。請先確認尚未開始製作，或已經與顧客完成溝通。
        </p>
        <label className="mt-4 block text-xs font-semibold text-stone-700">
          取消原因
          <select
            value={pending.reason}
            onChange={(event) => controller.setReason(event.target.value as CancellationReason)}
            className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
          >
            {cancellationReasonOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="mt-4 block text-xs font-semibold text-stone-700">
          補充說明{pending.reason === "OTHER" ? "（必填）" : "（選填）"}
          <textarea
            value={pending.detail}
            maxLength={200}
            onChange={(event) => controller.setDetail(event.target.value)}
            className="mt-1 min-h-20 w-full resize-y rounded-md border border-stone-300 p-3 text-sm"
          />
        </label>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            autoFocus
            disabled={updatingOrderId === pending.id || (pending.reason === "OTHER" && !pending.detail.trim())}
            onClick={controller.dismiss}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50"
          >
            返回訂單
          </button>
          <button
            type="button"
            disabled={updatingOrderId === pending.id}
            onClick={() => void controller.confirm()}
            className="rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updatingOrderId === pending.id ? "取消處理中…" : "確認取消訂單"}
          </button>
        </div>
      </section>
    </div>
  );
}
