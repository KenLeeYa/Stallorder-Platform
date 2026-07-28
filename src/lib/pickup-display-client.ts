export type PickupDisplayOrder = {
  orderNo: string;
  pickupCode: string | null;
  customerName: string | null;
  status: "PREPARING" | "READY";
  readyAt: string | null;
};

export type PublicPickupDisplay = {
  stall: {
    name: string;
    slug: string;
    logoUrl: string | null;
    backgroundImageUrl: string | null;
  };
  appearance: {
    accentColor: string;
    announcementText: string | null;
  };
  voice: {
    enabled: boolean;
    locale: string;
  };
  menuUrl: string | null;
  preparing: PickupDisplayOrder[];
  ready: PickupDisplayOrder[];
  refreshedAt: string;
};

export function pickupCodeForDisplay(
  pickupCode: string | null,
  showPickupCode: boolean,
  maskPickupCode: boolean,
) {
  if (!showPickupCode || !pickupCode) return null;
  if (!maskPickupCode) return pickupCode;
  if (pickupCode.length === 1) return "\u2022";
  return `${"\u2022".repeat(pickupCode.length - 1)}${pickupCode.slice(-1)}`;
}

export function pickupAnnouncementKey(order: PickupDisplayOrder) {
  return `${order.orderNo}:${order.readyAt ?? "ready"}`;
}

export function collectUnannouncedReadyOrders(
  orders: readonly PickupDisplayOrder[],
  announcedKeys: readonly string[],
) {
  const known = new Set(announcedKeys);
  const unannounced = orders.filter((order) => !known.has(pickupAnnouncementKey(order)));
  const nextKeys = [
    ...announcedKeys,
    ...unannounced.map(pickupAnnouncementKey),
  ].slice(-200);
  return { unannounced, nextKeys };
}

export function pickupVoiceMessage(order: PickupDisplayOrder) {
  return order.pickupCode
    ? `${order.orderNo} \u865f\u9910\u9ede\u5df2\u5b8c\u6210\uff0c\u8acb\u6191\u53d6\u9910\u78bc ${order.pickupCode} \u81f3\u6ac3\u53f0\u53d6\u9910\u3002`
    : `${order.orderNo} \u865f\u9910\u9ede\u5df2\u5b8c\u6210\uff0c\u8acb\u81f3\u6ac3\u53f0\u53d6\u9910\u3002`;
}
