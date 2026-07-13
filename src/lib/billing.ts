export type StallEntitlementInput = {
  subscriptionStatus: string;
  currentActiveStalls: number;
  includedStalls: number;
  maxStalls: number | null;
  approvedAdditionalStalls: number;
};

export function evaluateStallCreation(input: StallEntitlementInput) {
  const nextActiveStalls = input.currentActiveStalls + 1;
  if (!(["TRIALING", "ACTIVE"] as string[]).includes(input.subscriptionStatus)) {
    return { allowed: false as const, code: "SUBSCRIPTION_INACTIVE", nextActiveStalls };
  }
  if (input.maxStalls !== null && nextActiveStalls > input.maxStalls) {
    return { allowed: false as const, code: "PLAN_STALL_LIMIT", nextActiveStalls };
  }

  const requiredAdditionalStalls = Math.max(0, nextActiveStalls - input.includedStalls);
  if (requiredAdditionalStalls > input.approvedAdditionalStalls) {
    return {
      allowed: false as const,
      code: "ADDITIONAL_STALL_APPROVAL_REQUIRED",
      nextActiveStalls,
      requiredAdditionalStalls,
    };
  }
  return { allowed: true as const, code: null, nextActiveStalls, requiredAdditionalStalls };
}

export function calculateBillingEstimate({
  basePrice,
  activeStalls,
  includedStalls,
  defaultAdditionalStallPrice,
  approvals,
  orderCount,
  includedOrders,
  excessOrderPrice,
}: {
  basePrice: number;
  activeStalls: number;
  includedStalls: number;
  defaultAdditionalStallPrice: number | null;
  approvals: Array<{ quantity: number; unitPrice: number }>;
  orderCount: number;
  includedOrders: number | null;
  excessOrderPrice: number;
}) {
  const additionalStallCount = Math.max(0, activeStalls - includedStalls);
  let remainingStalls = additionalStallCount;
  let additionalStallFee = 0;
  for (const approval of approvals) {
    const applied = Math.min(remainingStalls, approval.quantity);
    additionalStallFee += applied * approval.unitPrice;
    remainingStalls -= applied;
    if (remainingStalls === 0) break;
  }
  if (remainingStalls > 0 && defaultAdditionalStallPrice !== null) {
    additionalStallFee += remainingStalls * defaultAdditionalStallPrice;
  }

  const excessOrderCount = includedOrders === null ? 0 : Math.max(0, orderCount - includedOrders);
  const excessOrderFee = excessOrderCount * excessOrderPrice;
  return {
    basePrice,
    activeStalls,
    additionalStallCount,
    unapprovedAdditionalStallCount: remainingStalls,
    additionalStallFee,
    orderCount,
    excessOrderCount,
    excessOrderFee,
    estimatedTotal: basePrice + additionalStallFee + excessOrderFee,
  };
}
