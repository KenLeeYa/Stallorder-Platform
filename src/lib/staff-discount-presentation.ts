import { calculateOrderDiscount } from "@/lib/checkout";

export type StaffDiscountState = "DISABLED" | "EMPTY" | "AVAILABLE";

export function getStaffDiscountState(enabled: boolean, activeOptionCount: number): StaffDiscountState {
  if (!enabled) return "DISABLED";
  return activeOptionCount > 0 ? "AVAILABLE" : "EMPTY";
}

export function getStaffCheckoutPreview(
  orders: readonly {
    subtotal: number;
    discountEligibleSubtotal?: number;
    total: number;
    discountLabel: string | null;
  }[],
  selectedDiscount: { name: string; rateBps: number } | null,
) {
  const subtotal = orders.reduce((sum, order) => sum + order.subtotal, 0);
  const total = selectedDiscount
    ? orders.reduce(
        (sum, order) => sum + calculateOrderDiscount(
          order.subtotal,
          order.discountEligibleSubtotal ?? order.subtotal,
          selectedDiscount.rateBps,
        ).total,
        0,
      )
    : orders.reduce((sum, order) => sum + order.total, 0);
  const existingLabels = [...new Set(
    orders.map((order) => order.discountLabel).filter((label): label is string => Boolean(label)),
  )];
  return {
    subtotal,
    total,
    discountAmount: subtotal - total,
    discountLabel: selectedDiscount?.name
      ?? (existingLabels.length === 1 ? existingLabels[0] : null),
  };
}
