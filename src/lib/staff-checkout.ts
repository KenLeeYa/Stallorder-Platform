import "server-only";

import type { UserRole } from "@prisma/client";
import { calculateCheckout, paymentMethodForKind } from "@/lib/checkout";
import { resolveDiscountApproval } from "@/lib/discount-approval";
import { prisma } from "@/lib/prisma";

export type StaffCheckoutInput = {
  paymentOptionId?: string | null;
  discountOptionId?: string | null;
  cashReceived?: number | null;
  discountApprovalReason?: string | null;
  managerEmail?: string | null;
  managerPassword?: string | null;
};

export class StaffCheckoutError extends Error {
  constructor(public readonly code:
    | "PAYMENT_REQUIRED"
    | "PAYMENT_INVALID"
    | "DISCOUNT_DISABLED"
    | "DISCOUNT_INVALID"
    | "INSUFFICIENT_CASH") {
    super(code);
  }
}

export async function resolveStaffCheckout(input: {
  organizationId: string;
  stallId: string;
  subtotals: readonly number[];
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

  const rateBps = discount?.rateBps ?? 10_000;
  const perOrderAmounts = input.subtotals.map((subtotal) => calculateCheckout(subtotal, rateBps));
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
