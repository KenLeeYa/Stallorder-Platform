type OrderSource = { source: string; fulfillmentType: string };

export function isPublicStaffAmendment(order: OrderSource) {
  return (order.source === "QR_MENU" && ["TAKEOUT", "DINE_IN", "DELIVERY"].includes(order.fulfillmentType))
    || (order.source === "LINE_DELIVERY" && order.fulfillmentType === "DELIVERY");
}

export function isStaffEditableOrderState(order: OrderSource & { status: string }) {
  if (order.source === "STAFF_POS") return order.status === "CONFIRMED";
  return isPublicStaffAmendment(order)
    && (order.status === "WAITING_CONFIRMATION" || order.status === "CONFIRMED");
}
