import type {
  QrOrderEntryChannel,
  QrOrderSession,
} from "@/components/qr-order-flow-orchestration";
import { buildFulfillmentTimeSlots } from "@/lib/fulfillment-time-options";
import type { QrCartLine, QrCartOrderingMode } from "@/lib/qr-cart";
import {
  prunePublicCartLinesForProducts,
  publicMenuProductsForPickup,
} from "@/lib/public-menu-availability";
import type { PublicMenuProduct } from "@/lib/public-menu-types";

export type QrOrderFulfillmentEffects = {
  onScheduleApplied: (value: string) => void;
  onDraftChanged: (value: string) => void;
  onMessageCleared: () => void;
  onCartChanged: (lines: QrCartLine[]) => void;
  onProductsReconciled: (
    products: PublicMenuProduct[],
    lines: QrCartLine[],
  ) => void;
  onLotteryCleared: () => void;
};

type QrOrderFulfillmentInput = {
  value: string;
  orderingMode: QrCartOrderingMode;
  session: QrOrderSession | null;
  cartLines: QrCartLine[];
};

export function buildQrOrderFulfillmentViewModel({
  entryChannel,
  session,
  orderingMode,
  scheduledPickupAt,
  draftScheduledPickupAt,
}: {
  entryChannel: QrOrderEntryChannel;
  session: QrOrderSession | null;
  orderingMode: QrCartOrderingMode;
  scheduledPickupAt: string;
  draftScheduledPickupAt: string;
}) {
  const slots = session
    ? buildFulfillmentTimeSlots(session.preorderSlots, session.stall.timezone)
    : [];
  const preorder = orderingMode === "PREORDER";
  const delivery = orderingMode === "DELIVERY";
  return {
    slots,
    canSelect: entryChannel === "SHARED_LINK"
      && session !== null
      && session.stall.fulfillmentType !== "DINE_IN"
      && slots.length > 0,
    value: preorder ? draftScheduledPickupAt : scheduledPickupAt,
    label: preorder
      ? "預約取餐時間"
      : delivery
        ? "指定送達時間（選填）"
        : "預計取餐時間（選填）",
    scheduledLabel: delivery ? "指定送達時間" : "指定取餐時間",
    dateLabel: preorder
      ? "預約取餐日期"
      : delivery
        ? "送達日期"
        : "取餐日期",
    timeLabel: preorder
      ? "預約取餐時間"
      : delivery
        ? "送達時間"
        : "取餐時間",
    allowAsap: !preorder,
    required: preorder,
    hasUnappliedTime: preorder && draftScheduledPickupAt !== scheduledPickupAt,
    testId: `qr-${orderingMode.toLowerCase()}-fulfillment-time-fields`,
  };
}

export function selectQrOrderFulfillmentTime(
  input: QrOrderFulfillmentInput,
  effects: QrOrderFulfillmentEffects,
) {
  if (input.orderingMode === "PREORDER") {
    if (!validFulfillmentTime(input.value, input.orderingMode, input.session)) return false;
    effects.onDraftChanged(input.value);
    effects.onMessageCleared();
    return true;
  }
  return applyQrOrderFulfillmentTime(input, effects);
}

export function applyQrOrderFulfillmentTime(
  input: QrOrderFulfillmentInput,
  effects: QrOrderFulfillmentEffects,
) {
  if (!validFulfillmentTime(input.value, input.orderingMode, input.session)) return false;
  effects.onScheduleApplied(input.value);
  effects.onDraftChanged(input.value);
  effects.onMessageCleared();
  if (input.orderingMode !== "PREORDER" || !input.session) return true;

  const availableProducts = publicMenuProductsForPickup(
    input.session.products,
    input.value,
  );
  const lines = prunePublicCartLinesForProducts(availableProducts, input.cartLines);
  effects.onCartChanged(lines);
  effects.onProductsReconciled(availableProducts, lines);
  effects.onLotteryCleared();
  return true;
}

function validFulfillmentTime(
  value: string,
  orderingMode: QrCartOrderingMode,
  session: QrOrderSession | null,
) {
  return session !== null
    && !(value === "" && orderingMode === "PREORDER")
    && (value === "" || session.preorderSlots.includes(value));
}
