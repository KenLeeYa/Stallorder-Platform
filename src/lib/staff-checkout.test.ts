import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findSettings: vi.fn(),
  findPayment: vi.fn(),
  findDiscount: vi.fn(),
  resolveApproval: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stallOrderingSettings: { findUnique: mocks.findSettings },
    paymentOption: { findFirst: mocks.findPayment },
    discountOption: { findFirst: mocks.findDiscount },
  },
}));
vi.mock("@/lib/discount-approval", () => ({
  resolveDiscountApproval: mocks.resolveApproval,
}));

import { resolveStaffCheckout } from "@/lib/staff-checkout";

describe("resolveStaffCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSettings.mockResolvedValue({
      paymentModuleEnabled: false,
      discountModuleEnabled: true,
      discountApprovalThresholdBps: 8_000,
    });
    mocks.findPayment.mockResolvedValue({ id: "cash", name: "現金", kind: "CASH" });
    mocks.findDiscount.mockResolvedValue(null);
    mocks.resolveApproval.mockResolvedValue({ approvedById: null, reason: null });
  });

  it("preserves an existing lottery total when staff does not choose another discount", async () => {
    const checkout = await resolveStaffCheckout({
      organizationId: "org",
      stallId: "stall",
      subtotals: [100],
      discountEligibleSubtotals: [100],
      currentTotals: [80],
      actorProfileId: "staff",
      actorRoles: ["STAFF"],
      request: {},
    });

    expect(checkout).toMatchObject({
      subtotal: 100,
      discountAmount: 20,
      total: 80,
      cashReceived: 80,
      changeAmount: 0,
      discountOptionId: null,
    });
  });

  it("uses an explicitly selected staff discount instead of the existing total", async () => {
    mocks.findDiscount.mockResolvedValue({ id: "staff-discount", name: "九折", rateBps: 9_000 });

    const checkout = await resolveStaffCheckout({
      organizationId: "org",
      stallId: "stall",
      subtotals: [100],
      discountEligibleSubtotals: [100],
      currentTotals: [80],
      actorProfileId: "staff",
      actorRoles: ["STAFF"],
      request: { discountOptionId: "staff-discount", cashReceived: 100 },
    });

    expect(checkout).toMatchObject({
      subtotal: 100,
      discountAmount: 10,
      total: 90,
      cashReceived: 100,
      changeAmount: 10,
      discountOptionId: "staff-discount",
    });
  });

  it("applies a selected discount only to eligible item totals", async () => {
    mocks.findDiscount.mockResolvedValue({ id: "staff-discount", name: "九折", rateBps: 9_000 });

    const checkout = await resolveStaffCheckout({
      organizationId: "org",
      stallId: "stall",
      subtotals: [150],
      discountEligibleSubtotals: [100],
      currentTotals: [150],
      actorProfileId: "staff",
      actorRoles: ["STAFF"],
      request: { discountOptionId: "staff-discount", cashReceived: 150 },
    });

    expect(checkout).toMatchObject({
      subtotal: 150,
      discountEligibleSubtotal: 100,
      discountAmount: 10,
      total: 140,
      changeAmount: 10,
    });
  });

  it("rejects a discount when no order amount is eligible", async () => {
    mocks.findDiscount.mockResolvedValue({ id: "staff-discount", name: "九折", rateBps: 9_000 });

    await expect(resolveStaffCheckout({
      organizationId: "org",
      stallId: "stall",
      subtotals: [150],
      discountEligibleSubtotals: [0],
      actorProfileId: "staff",
      actorRoles: ["STAFF"],
      request: { discountOptionId: "staff-discount" },
    })).rejects.toMatchObject({ code: "DISCOUNT_NOT_APPLICABLE" });
    expect(mocks.resolveApproval).not.toHaveBeenCalled();
  });

  it("rounds a multi-order discount per order", async () => {
    mocks.findDiscount.mockResolvedValue({ id: "half", name: "五折", rateBps: 5_000 });

    const checkout = await resolveStaffCheckout({
      organizationId: "org",
      stallId: "stall",
      subtotals: [1, 1],
      discountEligibleSubtotals: [1, 1],
      actorProfileId: "staff",
      actorRoles: ["STAFF"],
      request: { discountOptionId: "half" },
    });

    expect(checkout.total).toBe(2);
    expect(checkout.discountAmount).toBe(0);
  });
});
