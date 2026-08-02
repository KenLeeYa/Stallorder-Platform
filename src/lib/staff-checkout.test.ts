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
});
