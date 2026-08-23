import "server-only";

import type { UserRole } from "@prisma/client";
import { calculateOrderDiscount, paymentMethodForKind } from "@/lib/checkout";
import { resolveDiscountApproval } from "@/lib/discount-approval";
import { prisma } from "@/lib/prisma";

export type StaffCheckoutInput = {
  paymentOptionId?: string | null;
  discountOptionId?: string | null;
  cashReceived?: number | null;
  discountApprovalReason?: string | null;
  managerEmail?: string | null;
  managerPassword?: string | null;
  managerAuthorizationCode?: string | null;
};

export class StaffCheckoutError extends Error {
  constructor(public readonly code:
    | "PAYMENT_REQUIRED"
    | "PAYMENT_INVALID"
    | "DISCOUNT_DISABLED"
    | "DISCOUNT_INVALID"
    | "DISCOUNT_NOT_APPLICABLE"
    | "INSUFFICIENT_CASH") {
    super(code);
  }
}

export async function resolveStaffCheckout(input: {
  organizationId: string;
  stallId: string;
  subtotals: readonly number[];
  discountEligibleSubtotals: readonly number[];
  currentTotals?: readonly number[];
  actorProfileId: string;
  actorRoles: readonly UserRole[];
  request: StaffCheckoutInput;
}) {
  const settings = await prisma.stallOrderingSettings.findUnique({
    where: { stallId: input.stallId },
    select: {
      paymentModuleEnabled: true,
      discountModuleEnabled: true,
      discountApprovalThresholdBps: true,
    },
  });
  const paymentModuleEnabled = settings?.paymentModuleEnabled ?? false;
  const discountModuleEnabled = settings?.discountModuleEnabled ?? false;

  const requestedPaymentOptionId = input.request.paymentOptionId ?? null;
  if (paymentModuleEnabled && !requestedPaymentOptionId) {
    throw new StaffCheckoutError("PAYMENT_REQUIRED");
  }
  const paymentOption = requestedPaymentOptionId
    ? await prisma.paymentOption.findFirst({
        where: {
          id: requestedPaymentOptionId,
          stallId: input.stallId,
          organizationId: input.organizationId,
          isEnabled: true,
        },
        select: { id: true, name: true, kind: true },
      })
    : await prisma.paymentOption.findFirst({
        where: {
          stallId: input.stallId,
          organizationId: input.organizationId,
          kind: "CASH",
          isEnabled: true,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, kind: true },
      });
  if (requestedPaymentOptionId && !paymentOption) throw new StaffCheckoutError("PAYMENT_INVALID");

  const requestedDiscountOptionId = input.request.discountOptionId ?? null;
  if (!discountModuleEnabled && requestedDiscountOptionId) {
    throw new StaffCheckoutError("DISCOUNT_DISABLED");
  }
  const discount = requestedDiscountOptionId
    ? await prisma.discountOption.findFirst({
        where: {
          id: requestedDiscountOptionId,
          stallId: input.stallId,
          organizationId: input.organizationId,
          isEnabled: true,
        },
        select: { id: true, name: true, rateBps: true },
      })
    : null;
  if (requestedDiscountOptionId && !discount) throw new StaffCheckoutError("DISCOUNT_INVALID");

  if (
    input.discountEligibleSubtotals.length !== input.subtotals.length
    || (input.currentTotals && input.currentTotals.length !== input.subtotals.length)
  ) {
    throw new StaffCheckoutError("DISCOUNT_INVALID");
  }
  const discountEligibleSubtotal = input.discountEligibleSubtotals.reduce((sum, amount) => sum + amount, 0);
  if (discount && discountEligibleSubtotal === 0) {
    throw new StaffCheckoutError("DISCOUNT_NOT_APPLICABLE");
  }
  const rateBps = discount?.rateBps ?? 10_000;
  const perOrderAmounts = input.subtotals.map((subtotal, index) => {
    const eligibleSubtotal = input.discountEligibleSubtotals[index];
    let discounted;
    try {
      discounted = calculateOrderDiscount(subtotal, eligibleSubtotal, rateBps);
    } catch {
      throw new StaffCheckoutError("DISCOUNT_INVALID");
    }
    if (discount || !input.currentTotals) return discounted;

    const currentTotal = input.currentTotals[index];
    if (!Number.isInteger(currentTotal) || currentTotal < 0 || currentTotal > subtotal) {
      throw new StaffCheckoutError("DISCOUNT_INVALID");
    }
    return {
      subtotal,
      discountEligibleSubtotal: eligibleSubtotal,
      discountAmount: subtotal - currentTotal,
      total: currentTotal,
      cashReceived: currentTotal,
      changeAmount: 0,
    };
  });
  const subtotal = input.subtotals.reduce((total, amount) => total + amount, 0);
  const total = perOrderAmounts.reduce((sum, amount) => sum + amount.total, 0);
  const discountAmount = subtotal - total;
  const paymentKind = paymentOption?.kind ?? "CASH";
  const usesCash = paymentKind === "CASH";
  const cashReceived = usesCash ? input.request.cashReceived ?? total : null;
  if (cashReceived !== null && cashReceived < total) throw new StaffCheckoutError("INSUFFICIENT_CASH");

  const approval = discount
    ? await resolveDiscountApproval({
        organizationId: input.organizationId,
        stallId: input.stallId,
        actorProfileId: input.actorProfileId,
        actorRoles: input.actorRoles,
        discountRateBps: discount.rateBps,
        thresholdBps: settings?.discountApprovalThresholdBps ?? 8000,
        reason: input.request.discountApprovalReason,
        managerEmail: input.request.managerEmail,
        managerPassword: input.request.managerPassword,
        managerAuthorizationCode: input.request.managerAuthorizationCode,
      })
    : { approvedById: null, reason: null };

  return {
    paymentOptionId: paymentOption?.id ?? null,
    method: paymentMethodForKind(paymentKind),
    methodLabel: paymentOption?.name ?? "現金",
    discountOptionId: discount?.id ?? null,
    discountLabel: discount?.name ?? null,
    discountRateBps: discount?.rateBps ?? null,
    discountAmount,
    discountEligibleSubtotal,
    subtotal,
    total,
    cashReceived,
    changeAmount: cashReceived === null ? null : cashReceived - total,
    discountAppliedById: discount ? input.actorProfileId : null,
    discountApprovedById: approval.approvedById,
    discountApprovalReason: approval.reason,
    perOrderAmounts,
  };
}
