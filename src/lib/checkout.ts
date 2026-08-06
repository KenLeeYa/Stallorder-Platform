import type { PaymentMethod, PaymentOptionKind } from "@prisma/client";

export function calculateCheckout(
  subtotal: number,
  rateBps = 10_000,
  cashReceived?: number | null,
) {
  const amounts = calculateOrderDiscount(subtotal, subtotal, rateBps);
  const total = amounts.total;
  const received = cashReceived ?? total;
  if (!Number.isInteger(received) || received < total) throw new Error("INSUFFICIENT_CASH");

  return {
    subtotal,
    discountAmount: amounts.discountAmount,
    total,
    cashReceived: received,
    changeAmount: received - total,
  };
}

export function calculateOrderDiscount(
  subtotal: number,
  discountEligibleSubtotal: number,
  rateBps = 10_000,
) {
  if (!Number.isInteger(subtotal) || subtotal < 0) throw new Error("INVALID_SUBTOTAL");
  if (
    !Number.isInteger(discountEligibleSubtotal)
    || discountEligibleSubtotal < 0
    || discountEligibleSubtotal > subtotal
  ) throw new Error("INVALID_DISCOUNT_ELIGIBLE_SUBTOTAL");
  if (!Number.isInteger(rateBps) || rateBps < 1 || rateBps > 10_000) {
    throw new Error("INVALID_DISCOUNT_RATE");
  }

  const discountedEligible = Math.round((discountEligibleSubtotal * rateBps) / 10_000);
  const discountAmount = discountEligibleSubtotal - discountedEligible;
  return {
    subtotal,
    discountEligibleSubtotal,
    discountAmount,
    total: subtotal - discountAmount,
  };
}

export function paymentMethodForKind(kind: PaymentOptionKind): PaymentMethod {
  return kind === "CASH" ? "CASH" : "OTHER";
}
