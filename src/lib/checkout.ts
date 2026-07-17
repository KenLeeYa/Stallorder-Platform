import type { PaymentMethod, PaymentOptionKind } from "@prisma/client";

export function calculateCheckout(
  subtotal: number,
  rateBps = 10_000,
  cashReceived?: number | null,
) {
  if (!Number.isInteger(subtotal) || subtotal < 0) throw new Error("INVALID_SUBTOTAL");
  if (!Number.isInteger(rateBps) || rateBps < 1 || rateBps > 10_000) {
    throw new Error("INVALID_DISCOUNT_RATE");
  }

  const total = Math.round((subtotal * rateBps) / 10_000);
  const received = cashReceived ?? total;
  if (!Number.isInteger(received) || received < total) throw new Error("INSUFFICIENT_CASH");

  return {
    subtotal,
    discountAmount: subtotal - total,
    total,
    cashReceived: received,
    changeAmount: received - total,
  };
}

export function paymentMethodForKind(kind: PaymentOptionKind): PaymentMethod {
  return kind === "CASH" ? "CASH" : "OTHER";
}
