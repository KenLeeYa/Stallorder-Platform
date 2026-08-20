export type PublicOrderingMode = "DEFAULT" | "DELIVERY" | "PREORDER";

export type PublicOrderCapacity = {
  quote_min_minutes?: number;
  quote_max_minutes?: number;
  acknowledgment_threshold_minutes?: number;
  requires_acknowledgment?: boolean;
};

export type StoredPublicOrderContract = {
  order_id: string;
  order_no: string;
  order_status: string;
  payment_status: string;
  total_amount: number;
  fulfillment_type?: string;
  pickup_required?: boolean;
  quoted_wait_minutes?: number | null;
  quoted_ready_at?: string | null;
  scheduled_pickup_at?: string | null;
  requested_fulfillment_at?: string | null;
  discount_amount?: number;
  created_at: string;
};

type PublicOrderLine = {
  productId: string;
  quantity: number;
  note: string;
  noteOptionIds: string[];
  bundleChoiceIds: string[];
};

export function publicOrderSessionAbuseBehavior(input: {
  orderingMode: PublicOrderingMode;
  clientIp: string;
  deviceId: string;
  qrToken: string;
}) {
  return `scan:${input.orderingMode}:${input.clientIp}:${input.deviceId}:${input.qrToken}`;
}

export function publicOrderSubmissionAbuseBehavior(input: {
  orderingMode: PublicOrderingMode;
  deviceId: string;
  qrToken: string;
  scheduledPickupAt: string | null;
  lotteryDrawId: string | null;
  canonicalItems: string;
}) {
  return `order:${input.orderingMode}:${input.deviceId}:${input.qrToken}:${input.scheduledPickupAt ?? ""}:${input.lotteryDrawId ?? ""}:${input.canonicalItems}`;
}

export function publicOrderItemsToRpc(items: readonly PublicOrderLine[]) {
  return items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    note: item.note,
    modifier_option_ids: item.noteOptionIds,
    bundle_choice_ids: item.bundleChoiceIds,
  }));
}

export function publicOrderNeedsPickupCode(order: StoredPublicOrderContract) {
  const fulfillmentType = order.fulfillment_type ?? "TAKEOUT";
  return order.pickup_required === true
    || (order.pickup_required === undefined && fulfillmentType === "TAKEOUT");
}

export function buildPublicOrderResponse(
  order: StoredPublicOrderContract,
  trackingToken: string,
  pickupCode: string,
  canonicalCreatedAt: string,
) {
  const fulfillmentType = order.fulfillment_type ?? "TAKEOUT";
  return {
    orderNo: order.order_no,
    trackingToken,
    pickupVerificationCode: publicOrderNeedsPickupCode(order) ? pickupCode : null,
    fulfillmentType,
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    totalAmount: order.total_amount,
    quotedWaitMinutes: order.quoted_wait_minutes ?? null,
    quotedReadyAt: order.quoted_ready_at ?? null,
    scheduledPickupAt: order.scheduled_pickup_at ?? null,
    requestedFulfillmentAt: order.requested_fulfillment_at ?? null,
    discountAmount: order.discount_amount ?? 0,
    createdAt: canonicalCreatedAt,
  };
}

export function buildPublicOrderFailureBody(
  code: string,
  message: string,
  capacity?: PublicOrderCapacity | null,
) {
  return {
    error: message,
    code,
    ...buildPublicOrderCapacityDetails(capacity),
  };
}

export function buildPublicOrderCapacityDetails(
  capacity?: PublicOrderCapacity | null,
) {
  return capacity ? {
    capacity: {
      estimatedWaitMinMinutes: capacity.quote_min_minutes ?? null,
      estimatedWaitMaxMinutes: capacity.quote_max_minutes ?? null,
      requiresWaitAcknowledgment: capacity.requires_acknowledgment === true,
    },
  } : {};
}

export function buildPublicOrderResumeResponse(
  orderingMode: PublicOrderingMode,
  trackingToken: string,
  orderStatus: string,
) {
  return {
    orderingMode,
    resumeOrder: { trackingToken, orderStatus },
  };
}

export function buildPublicOrderSessionResponse(input: {
  orderSessionToken: string;
  expiresAt: string;
  orderingMode: PublicOrderingMode;
  capacity?: PublicOrderCapacity | null;
  fallbackWaitMinutes?: number | null;
}) {
  const preorderSession = input.orderingMode === "PREORDER";
  const fallbackWaitMinutes = input.fallbackWaitMinutes ?? null;
  return {
    orderSessionToken: input.orderSessionToken,
    expiresAt: input.expiresAt,
    orderingMode: input.orderingMode,
    estimatedWaitMinutes: preorderSession
      ? 0
      : input.capacity?.quote_max_minutes ?? fallbackWaitMinutes,
    estimatedWaitMinMinutes: preorderSession
      ? 0
      : input.capacity?.quote_min_minutes ?? fallbackWaitMinutes,
    estimatedWaitMaxMinutes: preorderSession
      ? 0
      : input.capacity?.quote_max_minutes ?? fallbackWaitMinutes,
    waitAcknowledgmentThresholdMinutes: preorderSession
      ? null
      : input.capacity?.acknowledgment_threshold_minutes ?? null,
    requiresWaitAcknowledgment: preorderSession
      ? false
      : input.capacity?.requires_acknowledgment === true,
  };
}
