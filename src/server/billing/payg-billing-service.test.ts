import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transactionRunner: vi.fn(),
  transaction: {
    $queryRaw: vi.fn(),
    billingFeatureFlag: { findMany: vi.fn() },
    subscription: { findUnique: vi.fn(), update: vi.fn() },
    planVersion: { findFirst: vi.fn() },
    billingChangeRequest: { findUnique: vi.fn(), update: vi.fn() },
    billingStallUsageSummary: { findMany: vi.fn() },
    invoice: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    invoiceLineItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    billingCreditAdjustment: { findMany: vi.fn(), updateMany: vi.fn() },
    manualPaymentRecord: { count: vi.fn() },
    organization: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transactionRunner } }));

import { PaygBillingService } from "./payg-billing-service";
import { calculatePaygContractHash, type PaygContractVersion } from "./payg-contract";

const context = {
  actorProfileId: "55555555-5555-4555-8555-555555555551",
  requestId: "payg-migration-approval",
};

const paygContract: PaygContractVersion = {
  id: "payg-version-id",
  planId: "payg-plan-id",
  version: 1,
  displayName: "PAYG",
  billingInterval: "MONTHLY",
  currency: "TWD",
  basePrice: 0,
  annualPrice: null,
  trialDays: null,
  includedStalls: 1,
  maxStalls: null,
  additionalStallPrice: null,
  maxStaff: null,
  maxProducts: null,
  maxQrCodes: null,
  includedOrders: null,
  reportRetentionDays: null,
  overagePolicy: "HARD_BLOCK",
  pricingMode: "USAGE_PER_STALL_CAPPED",
  usageUnitPrice: 1,
  usageMetric: "NET_BILLABLE_COMPLETED_ORDER",
  usageScope: "STALL",
  monthlyCapAmount: 1499,
  minimumCharge: 0,
  billingTimezone: "Asia/Taipei",
  billingCycleAnchorDay: 1,
  billingPeriodType: "CALENDAR_MONTH",
  invoiceCloseDelayHours: 24,
  taxTreatment: "EXEMPT",
  taxRateBps: null,
  taxJurisdiction: "TW",
  taxRoundingMode: "HALF_UP",
  taxRoundingScope: "INVOICE",
  capTaxBasis: null,
  taxDocumentRequired: false,
  sealedAt: new Date("2026-07-01T00:00:00.000Z"),
  sealedByProfileId: context.actorProfileId,
  contractHash: null,
  entitlements: [],
};

const paygVersion = {
  ...paygContract,
  contractHash: calculatePaygContractHash(paygContract),
  plan: { code: "PAYG" },
};

const subscription = {
  id: "subscription-id",
  organizationId: "organization-id",
  planId: "pro-plan-id",
  planVersionId: "pro-version-id",
  billingTimezone: "Asia/Taipei",
  billingCycleAnchorDay: 1,
  billingPeriodType: "CALENDAR_MONTH",
  invoiceCloseDelayHours: 24,
  billingPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
  billingPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
  plan: { code: "PRO" },
  planVersion: { id: "pro-version-id" },
};

describe("PaygBillingService migration approval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T04:00:00.000Z"));
    vi.clearAllMocks();
    mocks.transactionRunner.mockImplementation(async (
      operation: (transaction: typeof mocks.transaction) => Promise<unknown>,
    ) => operation(mocks.transaction));
    mocks.transaction.billingFeatureFlag.findMany.mockResolvedValue([
      { code: "PAYG_BILLING_ENABLED", isEnabled: true },
      { code: "PAYG_LEGACY_MIGRATION_ENABLED", isEnabled: true },
    ]);
    mocks.transaction.subscription.findUnique.mockResolvedValue(subscription);
    mocks.transaction.subscription.update.mockResolvedValue({ ...subscription, planId: paygVersion.planId });
    mocks.transaction.billingChangeRequest.findUnique.mockResolvedValue({
      id: "change-request-id",
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      requestType: "PLAN_CHANGE",
      status: "PENDING",
      requestedPlanVersion: paygVersion,
    });
    mocks.transaction.billingChangeRequest.update.mockResolvedValue({ id: "change-request-id", status: "APPROVED" });
    mocks.transaction.organization.update.mockResolvedValue({ id: subscription.organizationId });
    mocks.transaction.auditLog.create.mockResolvedValue({ id: "audit-id" });
  });

  afterEach(() => vi.useRealTimers());

  it("migrates to the exact requested version and closes the pending request atomically", async () => {
    await expect(new PaygBillingService().migrateSubscription(
      subscription.id,
      {
        effectiveDate: new Date("2026-08-01T00:00:00.000Z"),
        reason: "merchant approved PAYG",
        confirmation: "MIGRATE_TO_PAYG",
        changeRequestId: "change-request-id",
      },
      context,
    )).resolves.toMatchObject({ planId: paygVersion.planId });

    expect(mocks.transaction.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: subscription.id },
      data: expect.objectContaining({
        planVersionId: paygVersion.id,
        pricingEffectiveAt: new Date("2026-07-31T16:00:00.000Z"),
      }),
    }));
    expect(mocks.transaction.billingChangeRequest.update).toHaveBeenCalledWith({
      where: { id: "change-request-id" },
      data: expect.objectContaining({ status: "APPROVED", decidedByProfileId: context.actorProfileId }),
    });
    expect(mocks.transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        afterJson: expect.objectContaining({ billingChangeRequestId: "change-request-id" }),
      }),
    });
  });

  it("rejects a non-month-boundary effective date", async () => {
    await expect(new PaygBillingService().migrateSubscription(
      subscription.id,
      {
        effectiveDate: new Date("2026-08-02T00:00:00.000Z"),
        reason: "invalid boundary",
        confirmation: "MIGRATE_TO_PAYG",
        changeRequestId: "change-request-id",
      },
      context,
    )).rejects.toMatchObject({ code: "PAYG_EFFECTIVE_DATE_INVALID" });

    expect(mocks.transaction.subscription.update).not.toHaveBeenCalled();
    expect(mocks.transaction.billingChangeRequest.update).not.toHaveBeenCalled();
  });

  it("rejects a request that does not belong to the subscription", async () => {
    mocks.transaction.billingChangeRequest.findUnique.mockResolvedValue({
      id: "change-request-id",
      organizationId: subscription.organizationId,
      subscriptionId: "another-subscription",
      requestType: "PLAN_CHANGE",
      status: "PENDING",
      requestedPlanVersion: paygVersion,
    });

    await expect(new PaygBillingService().migrateSubscription(
      subscription.id,
      {
        effectiveDate: new Date("2026-08-01T00:00:00.000Z"),
        reason: "mismatched request",
        confirmation: "MIGRATE_TO_PAYG",
        changeRequestId: "change-request-id",
      },
      context,
    )).rejects.toMatchObject({ code: "PAYG_CHANGE_REQUEST_INVALID" });

    expect(mocks.transaction.subscription.update).not.toHaveBeenCalled();
  });
});

describe("PaygBillingService period close", () => {
  const paygSubscription = {
    ...subscription,
    planId: paygVersion.planId,
    planVersionId: paygVersion.id,
    pricingEffectiveAt: new Date("2026-07-01T00:00:00.000Z"),
    plan: { code: "PAYG" },
    planVersion: paygVersion,
  };
  const invoice = {
    id: "invoice-id",
    subscriptionId: paygSubscription.id,
    planVersionId: paygVersion.id,
    pricingMode: "USAGE_PER_STALL_CAPPED",
    status: "OPEN",
    amountPaid: 0,
    totalAmount: 0,
    pricingSnapshotJson: null,
    issuedAt: new Date("2026-08-01T00:00:00.000Z"),
    lineItems: [],
    taxDocuments: [],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T04:00:00.000Z"));
    vi.clearAllMocks();
    mocks.transactionRunner.mockImplementation(async (
      operation: (transaction: typeof mocks.transaction) => Promise<unknown>,
    ) => operation(mocks.transaction));
    mocks.transaction.billingFeatureFlag.findMany.mockResolvedValue([
      { code: "OPEN_BETA_FREE_ACCESS_ENABLED", isEnabled: false },
      { code: "PAYG_BILLING_ENABLED", isEnabled: true },
      { code: "PAYG_REFUND_CREDITS_ENABLED", isEnabled: true },
    ]);
    mocks.transaction.subscription.findUnique.mockResolvedValue(paygSubscription);
    mocks.transaction.billingStallUsageSummary.findMany.mockResolvedValue([]);
    mocks.transaction.billingCreditAdjustment.findMany.mockResolvedValue([]);
    mocks.transaction.billingCreditAdjustment.updateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.invoice.findMany.mockResolvedValue([]);
    mocks.transaction.invoice.findUnique.mockResolvedValue(invoice);
    mocks.transaction.invoice.update.mockResolvedValue(invoice);
    mocks.transaction.invoiceLineItem.deleteMany.mockResolvedValue({ count: 0 });
    mocks.transaction.invoiceLineItem.createMany.mockResolvedValue({ count: 0 });
    mocks.transaction.manualPaymentRecord.count.mockResolvedValue(1);
    mocks.transaction.auditLog.create.mockResolvedValue({ id: "audit-id" });
  });

  afterEach(() => vi.useRealTimers());

  it.each(["OPEN", "OVERDUE"])(
    "rejects an %s invoice with a payment pending verification before mutation",
    async (status) => {
      mocks.transaction.invoice.findUnique.mockResolvedValue({ ...invoice, status });

      await expect(new PaygBillingService().closeBillingPeriod(
        paygSubscription.id,
        { billingPeriod: new Date("2026-07-01T00:00:00.000Z"), reason: "close period" },
        context,
      )).rejects.toMatchObject({ code: "PAYG_INVOICE_HAS_PENDING_PAYMENT" });

      expect(mocks.transaction.manualPaymentRecord.count).toHaveBeenCalledWith({
        where: { invoiceId: invoice.id, verificationStatus: "PENDING_VERIFICATION" },
      });
      expect(mocks.transaction.$queryRaw).toHaveBeenCalledTimes(3);
      expect(mocks.transaction.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mocks.transaction.manualPaymentRecord.count.mock.invocationCallOrder[0] ?? 0,
      );
      expect(mocks.transaction.invoiceLineItem.deleteMany).not.toHaveBeenCalled();
      expect(mocks.transaction.invoiceLineItem.createMany).not.toHaveBeenCalled();
      expect(mocks.transaction.invoice.update).not.toHaveBeenCalled();
      expect(mocks.transaction.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it("rejects the UTC month before a Taipei month-boundary effective date", async () => {
    mocks.transaction.subscription.findUnique.mockResolvedValue({
      ...paygSubscription,
      pricingEffectiveAt: new Date("2026-07-31T16:00:00.000Z"),
    });

    await expect(new PaygBillingService().closeBillingPeriod(
      paygSubscription.id,
      { billingPeriod: new Date("2026-07-01T00:00:00.000Z"), reason: "must not predate PAYG" },
      context,
    )).rejects.toMatchObject({ code: "PAYG_PERIOD_NOT_CLOSABLE" });

    expect(mocks.transaction.billingStallUsageSummary.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction.invoice.findUnique).not.toHaveBeenCalled();
  });

  it("closes the exact Taipei effective month after that period ends", async () => {
    vi.setSystemTime(new Date("2026-09-21T04:00:00.000Z"));
    mocks.transaction.subscription.findUnique.mockResolvedValue({
      ...paygSubscription,
      pricingEffectiveAt: new Date("2026-07-31T16:00:00.000Z"),
    });
    mocks.transaction.manualPaymentRecord.count.mockResolvedValue(0);

    await expect(new PaygBillingService().closeBillingPeriod(
      paygSubscription.id,
      { billingPeriod: new Date("2026-08-01T00:00:00.000Z"), reason: "close first PAYG month" },
      context,
    )).resolves.toMatchObject({ idempotent: false });

    expect(mocks.transaction.billingStallUsageSummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ billingPeriod: new Date("2026-08-01T00:00:00.000Z") }),
      }),
    );
  });

  it("still closes an editable invoice when no payment is pending verification", async () => {
    mocks.transaction.manualPaymentRecord.count.mockResolvedValue(0);

    await expect(new PaygBillingService().closeBillingPeriod(
      paygSubscription.id,
      { billingPeriod: new Date("2026-07-01T00:00:00.000Z"), reason: "close period" },
      context,
    )).resolves.toMatchObject({ idempotent: false });

    expect(mocks.transaction.invoiceLineItem.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.invoice.update).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
