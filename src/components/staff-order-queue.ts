import type { StaffOrderDto } from "@/lib/orders";

export const STAFF_QUEUE_PAGE_SIZE = 5;
export const STAFF_QUEUE_FILTERS = ["ALL", "WAITING", "WORKING", "READY", "PRINT_ATTENTION"] as const;
export type StaffQueueFilter = (typeof STAFF_QUEUE_FILTERS)[number];
export type QueueOrder = Pick<StaffOrderDto, "id" | "status" | "primaryPrintStatus">;

function matches(order: QueueOrder, filter: StaffQueueFilter) {
  switch (filter) {
    case "ALL": return true;
    case "WAITING": return order.status === "WAITING_CONFIRMATION";
    case "WORKING": return ["CONFIRMED", "PREPARING", "PACKING"].includes(order.status);
    case "READY": return order.status === "READY";
    case "PRINT_ATTENTION": return order.primaryPrintStatus === "FAILED" || order.primaryPrintStatus === "CANCELLED";
  }
}

/** Presentation only: preserve server priority and never infer a payment or print transition. */
export function getStaffQueue<T extends QueueOrder>(orders: readonly T[], filter: StaffQueueFilter, requestedPage: number) {
  const counts = Object.fromEntries(STAFF_QUEUE_FILTERS.map((key) => [key, orders.filter((order) => matches(order, key)).length])) as Record<StaffQueueFilter, number>;
  const filtered = orders.filter((order) => matches(order, filter));
  const totalPages = Math.max(1, Math.ceil(filtered.length / STAFF_QUEUE_PAGE_SIZE));
  const page = Math.max(1, Math.min(totalPages, requestedPage));
  return {
    counts, page, totalPages, total: filtered.length,
    orders: filtered.slice((page - 1) * STAFF_QUEUE_PAGE_SIZE, page * STAFF_QUEUE_PAGE_SIZE),
  };
}

export const STAFF_QUEUE_SOURCES = ["ALL", "QR_MENU", "STAFF_POS", "LINE_DELIVERY", "OFFLINE_POS"] as const;
export type StaffQueueSource = (typeof STAFF_QUEUE_SOURCES)[number];
export function staffQueueSource(order: Pick<StaffOrderDto, "source" | "origin">): Exclude<StaffQueueSource, "ALL"> | null {
  if (order.origin === "OFFLINE_POS" || order.source === "OFFLINE_POS") return "OFFLINE_POS";
  if (order.source === "QR_MENU" || order.source === "STAFF_POS" || order.source === "LINE_DELIVERY") return order.source;
  return null;
}
export function filterStaffQueue<T extends Pick<StaffOrderDto, "source" | "origin" | "createdAt">>(orders: readonly T[], source: StaffQueueSource, recentOnly: boolean, now: Date) {
  return orders.filter((order) => (source === "ALL" || staffQueueSource(order) === source) && (!recentOnly || new Date(order.createdAt).getTime() >= now.getTime() - 60 * 60_000));
}
