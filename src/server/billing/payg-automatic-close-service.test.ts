import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  close: vi.fn(),
  subscriptionFindMany: vi.fn(),
  jobUpsert: vi.fn(),
  jobUpdateMany: vi.fn(),
  jobUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findMany: mocks.subscriptionFindMany },
    paygCloseJob: {
      upsert: mocks.jobUpsert,
      updateMany: mocks.jobUpdateMany,
      update: mocks.jobUpdate,
    },
  },
}));
vi.mock("@/server/billing/billing-feature-flags", () => ({
  getBillingExperienceState: mocks.getState,
}));
vi.mock("@/server/billing/payg-billing-service", () => ({
  PaygBillingError: class PaygBillingError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  paygBillingService: { closeBillingPeriod: mocks.close },
}));

import { processAutomaticPaygClose } from "./payg-automatic-close-service";

const readyState = {
  openBetaFreeAccess: false,
  paygBillingEnabled: true,
  paygRefundCreditsEnabled: true,
  paygAutomaticInvoiceCloseEnabled: true,
};

function subscription(id: string) {
  return {
    id,
    billingPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
    billingPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    billingTimezone: "Asia/Taipei",
    billingCycleAnchorDay: 1,
    billingPeriodType: "CALENDAR_MONTH",
    invoiceCloseDelayHours: 24,
    plan: { code: "PAYG" },
    planVersion: { entitlements: [] },
  };
}

describe("PAYG automatic close executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockResolvedValue(readyState);
    mocks.subscriptionFindMany.mockResolvedValue([subscription("subscription-1")]);
    mocks.jobUpsert.mockResolvedValue({ id: "job-1", status: "PENDING", attemptCount: 0 });
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.jobUpdate.mockResolvedValue({ id: "job-1" });
    mocks.close.mockResolvedValue({ idempotent: false });
  });

  it("does not query subscriptions while the automatic flag is disabled", async () => {
    mocks.getState.mockResolvedValue({ ...readyState, paygAutomaticInvoiceCloseEnabled: false });
    await expect(processAutomaticPaygClose(new Date("2026-08-02T00:00:00.000Z"))).resolves.toMatchObject({ status: "DISABLED" });
    expect(mocks.subscriptionFindMany).not.toHaveBeenCalled();
  });

  it("claims and closes an eligible period through the shared domain service", async () => {
    await expect(processAutomaticPaygClose(new Date("2026-08-02T00:00:00.000Z"))).resolves.toEqual({
      status: "COMPLETED",
      eligible: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
    });
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["PENDING", "FAILED"] } }),
    }));
    expect(mocks.close).toHaveBeenCalledWith(
      "subscription-1",
      expect.objectContaining({ billingPeriod: new Date("2026-07-01T00:00:00.000Z") }),
      expect.objectContaining({ actorProfileId: null }),
    );
  });

  it("skips when another worker already claimed the durable job", async () => {
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
    await expect(processAutomaticPaygClose(new Date("2026-08-02T00:00:00.000Z"))).resolves.toMatchObject({
      eligible: 1,
      succeeded: 0,
      skipped: 1,
      failed: 0,
    });
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("isolates a failed subscription and continues the batch", async () => {
    mocks.subscriptionFindMany.mockResolvedValue([subscription("subscription-1"), subscription("subscription-2")]);
    mocks.jobUpsert
      .mockResolvedValueOnce({ id: "job-1", status: "PENDING", attemptCount: 0 })
      .mockResolvedValueOnce({ id: "job-2", status: "PENDING", attemptCount: 0 });
    mocks.close.mockRejectedValueOnce(new Error("first failed")).mockResolvedValueOnce({ idempotent: false });
    await expect(processAutomaticPaygClose(new Date("2026-08-02T00:00:00.000Z"))).resolves.toMatchObject({
      eligible: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});
