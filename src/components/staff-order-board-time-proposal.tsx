"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { FulfillmentTimePicker } from "@/components/fulfillment-time-picker";
import type { StaffOrderFulfillmentTimeCommand } from "@/components/staff-order-board-fulfillment-time";
import { buildFulfillmentTimeSlots, type FulfillmentTimeSlot } from "@/lib/fulfillment-time-options";
import type { StaffOrderDto } from "@/lib/orders";

type TimeProposalOrder = Pick<
  StaffOrderDto,
  "id" | "orderNo" | "fulfillmentTimeVersion" | "requestedFulfillmentAt"
>;

type PendingTimeProposal = {
  orderId: string;
  orderNo: string;
  version: number;
  proposedFulfillmentAt: string;
  reason: string;
};

type TimeProposalCommand = Extract<
  StaffOrderFulfillmentTimeCommand,
  { operation: "PROPOSE" }
>;

type UseStaffOrderTimeProposalOptions = {
  slotValues: string[] | undefined;
  timeZone: string;
  updatingOrderId: string | null;
  onUnavailable: () => void;
  onConfirm: (orderId: string, command: TimeProposalCommand) => Promise<boolean>;
};

export type StaffOrderTimeProposalController = {
  pending: PendingTimeProposal | null;
  slots: FulfillmentTimeSlot[];
  canOpen: boolean;
  open: (order: TimeProposalOrder) => void;
  reconcile: (orders: readonly Pick<StaffOrderDto, "id">[]) => void;
  setProposedFulfillmentAt: (value: string) => void;
  setReason: (reason: string) => void;
  dismiss: () => void;
  confirm: () => Promise<void>;
};

export function useStaffOrderTimeProposal({
  slotValues,
  timeZone,
  updatingOrderId,
  onUnavailable,
  onConfirm,
}: UseStaffOrderTimeProposalOptions): StaffOrderTimeProposalController {
  const [pending, setPending] = useState<PendingTimeProposal | null>(null);
  const slots = useMemo(
    () => buildFulfillmentTimeSlots(slotValues ?? [], timeZone),
    [slotValues, timeZone],
  );

  const dismiss = useCallback(() => setPending(null), []);
  const open = useCallback((order: TimeProposalOrder) => {
    if (slots.length === 0) {
      onUnavailable();
      return;
    }
    const preferred = slots.find((slot) => slot.iso !== order.requestedFulfillmentAt)?.iso
      ?? slots[0]!.iso;
    setPending({
      orderId: order.id,
      orderNo: order.orderNo,
      version: order.fulfillmentTimeVersion,
      proposedFulfillmentAt: preferred,
      reason: "目前訂單較多，建議調整時間",
    });
  }, [onUnavailable, slots]);
  const reconcile = useCallback((orders: readonly Pick<StaffOrderDto, "id">[]) => {
    setPending((current) => (
      current && !orders.some((order) => order.id === current.orderId) ? null : current
    ));
  }, []);
  const setProposedFulfillmentAt = useCallback((proposedFulfillmentAt: string) => {
    setPending((current) => current ? { ...current, proposedFulfillmentAt } : null);
  }, []);
  const setReason = useCallback((reason: string) => {
    setPending((current) => current ? { ...current, reason } : null);
  }, []);

  const confirm = useCallback(async () => {
    if (
      !pending
      || updatingOrderId === pending.orderId
      || pending.reason.trim().length < 2
      || !pending.proposedFulfillmentAt
    ) return;
    const updated = await onConfirm(pending.orderId, {
      operation: "PROPOSE",
      version: pending.version,
      proposedFulfillmentAt: pending.proposedFulfillmentAt,
      reason: pending.reason.trim(),
    });
    if (updated) dismiss();
  }, [dismiss, onConfirm, pending, updatingOrderId]);

  useEffect(() => {
    if (!pending) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && updatingOrderId !== pending.orderId) dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismiss, pending, updatingOrderId]);

  return {
    pending,
    slots,
    canOpen: slots.length > 0,
    open,
    reconcile,
    setProposedFulfillmentAt,
    setReason,
    dismiss,
    confirm,
  };
}

export function StaffOrderTimeProposalDialog({
  controller,
  orders,
  updatingOrderId,
}: {
  controller: StaffOrderTimeProposalController;
  orders: readonly StaffOrderDto[];
  updatingOrderId: string | null;
}) {
  const pending = controller.pending;
  const order = pending
    ? orders.find((candidate) => candidate.id === pending.orderId) ?? null
    : null;
  if (!pending || !order) return null;

  const busy = updatingOrderId === order.id;
  const fulfillmentLabel = order.fulfillmentType === "DELIVERY" ? "送達" : "取餐";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="time-proposal-title"
        className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="time-proposal-title" className="text-lg font-semibold">
              提出新的{fulfillmentLabel}時間
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              訂單 {pending.orderNo}；送出後會通知顧客確認。
            </p>
          </div>
          <button
            type="button"
            title="關閉時間調整"
            disabled={busy}
            onClick={controller.dismiss}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <FulfillmentTimePicker
          slots={controller.slots}
          value={pending.proposedFulfillmentAt}
          onChange={controller.setProposedFulfillmentAt}
          legend="建議時間"
          scheduledLabel={`指定${fulfillmentLabel}時間`}
          dateLabel={`${fulfillmentLabel}日期`}
          timeLabel={`${fulfillmentLabel}時間`}
          unavailableDateMessage="所選日期目前沒有可提供給顧客的時段。"
          allowAsap={false}
          required
          disabled={busy}
          testId="staff-time-proposal-fields"
          className="mt-5"
        />
        <label className="mt-4 block text-xs font-semibold text-stone-700">
          調整原因
          <textarea
            value={pending.reason}
            maxLength={200}
            onChange={(event) => controller.setReason(event.target.value)}
            className="mt-1 min-h-20 w-full resize-y rounded-md border border-stone-300 p-3 text-sm"
          />
        </label>
        <p className="mt-3 text-xs leading-5 text-amber-800">
          顧客接受前會保留原本已確認的時間，且訂單不會開始製作。
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={controller.dismiss}
            className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            返回訂單
          </button>
          <button
            type="button"
            disabled={busy || pending.reason.trim().length < 2 || !pending.proposedFulfillmentAt}
            onClick={() => void controller.confirm()}
            className="min-h-11 rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "通知中…" : "通知顧客確認"}
          </button>
        </div>
      </section>
    </div>
  );
}
